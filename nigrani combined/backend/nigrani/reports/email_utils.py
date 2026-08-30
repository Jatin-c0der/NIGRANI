from django.core.mail import EmailMessage
from django.conf import settings

MIME_TO_EXTENSION = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/heic': 'heic',
    'image/heif': 'heif',
}


def send_report_email(report, image_bytes, mime_type):
    domains = sorted({v['domain'] for v in report.violations})
    subject = f"Anonymous Safety Complaint [{report.urgency}] - {' & '.join(domains)} Hazard"

    location_line = ''
    if report.latitude is not None and report.longitude is not None:
        location_line = f"\n\nLocation (approximate): {report.latitude}, {report.longitude}"

    body = f"{report.complaint_draft}{location_line}\n\nReport ID: {report.id}"

    email = EmailMessage(
        subject=subject,
        body=body,
        from_email=settings.DEFAULT_FROM_EMAIL,
        to=[settings.AUTHORITY_EMAIL],
        cc=[settings.NGO_EMAIL],
    )
    extension = MIME_TO_EXTENSION.get(mime_type, 'jpg')
    email.attach(f'incident.{extension}', image_bytes, mime_type)
    email.send(fail_silently=False)
