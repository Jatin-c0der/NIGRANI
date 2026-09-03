import logging
import uuid
from io import BytesIO
from PIL import Image, UnidentifiedImageError
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status, generics
from rest_framework.throttling import ScopedRateThrottle
from .models import Report
from .serializers import SendReportSerializer, ReportSerializer
from .gemini_client import analyze_image
from .email_utils import send_report_email
from .tokens import issue_analysis_token, verify_analysis_token

logger = logging.getLogger(__name__)

ALLOWED_IMAGE_TYPES = {'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'}
MAX_IMAGE_SIZE_BYTES = 10 * 1024 * 1024


def validate_image_file(image_file):
    if image_file.content_type not in ALLOWED_IMAGE_TYPES:
        return f"Unsupported image type '{image_file.content_type}'."
    if image_file.size > MAX_IMAGE_SIZE_BYTES:
        return 'Image exceeds 10MB limit.'
    return None


def verify_image_bytes(image_bytes):
    try:
        image = Image.open(BytesIO(image_bytes))
        image.verify()
    except (UnidentifiedImageError, OSError, ValueError):
        return 'Uploaded file could not be verified as a valid image.'
    return None


MAX_DESCRIPTION_LENGTH = 500


class AnalyzeView(APIView):
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = 'analyze'

    def post(self, request):
        image_file = request.FILES.get('image')
        if not image_file:
            return Response({'error': 'image file is required'}, status=status.HTTP_400_BAD_REQUEST)

        error = validate_image_file(image_file)
        if error:
            return Response({'error': error}, status=status.HTTP_400_BAD_REQUEST)

        description = request.data.get('description', '').strip()
        if len(description) > MAX_DESCRIPTION_LENGTH:
            return Response(
                {'error': f'Description exceeds {MAX_DESCRIPTION_LENGTH} character limit.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        image_bytes = image_file.read()

        error = verify_image_bytes(image_bytes)
        if error:
            return Response({'error': error}, status=status.HTTP_400_BAD_REQUEST)

        try:
            analysis = analyze_image(image_bytes, image_file.content_type, description)
        except Exception:
            logger.exception('Gemini analysis failed')
            return Response({'error': 'Analysis service is currently unavailable. Please try again.'},
                             status=status.HTTP_502_BAD_GATEWAY)

        analysis_token = issue_analysis_token(image_bytes, analysis)
        return Response({**analysis, 'analysis_token': analysis_token}, status=status.HTTP_200_OK)


class SendView(APIView):
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = 'send'

    def post(self, request):
        image_file = request.FILES.get('image')
        if not image_file:
            return Response({'error': 'image file is required'}, status=status.HTTP_400_BAD_REQUEST)

        error = validate_image_file(image_file)
        if error:
            return Response({'error': error}, status=status.HTTP_400_BAD_REQUEST)

        image_bytes = image_file.read()

        error = verify_image_bytes(image_bytes)
        if error:
            return Response({'error': error}, status=status.HTTP_400_BAD_REQUEST)

        serializer = SendReportSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

       analysis, token_error = verify_analysis_token(data['analysis_token'], image_bytes)
       if token_error:
           return Response({'error': token_error}, status=status.HTTP_400_BAD_REQUEST)

# Do not create or email a report if no hazard was detected
       if not analysis['violations']:
           return Response(
               {'error': 'No safety hazard was detected in the submitted photo.'},
               status=status.HTTP_400_BAD_REQUEST
           )

       mime_type = image_file.content_type

        report = Report(
            id=uuid.uuid4(),
            latitude=data.get('latitude'),
            longitude=data.get('longitude'),
            violations=analysis['violations'],
            why_dangerous=analysis['why_dangerous'],
            urgency=analysis['urgency'],
            complaint_draft=analysis['complaint_draft'],
            status='Sent',
        )

        try:
            send_report_email(report, image_bytes, mime_type)
        except Exception:
            logger.exception('Email dispatch failed for report %s', report.id)
            return Response(
                {'error': 'Report could not be sent. Please retry submission.'},
                status=status.HTTP_502_BAD_GATEWAY,
            )

        report.save()
        return Response(ReportSerializer(report).data, status=status.HTTP_201_CREATED)


class ReportListView(generics.ListAPIView):
    queryset = Report.objects.filter(status='Sent')
    serializer_class = ReportSerializer
