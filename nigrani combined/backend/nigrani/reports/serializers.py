from rest_framework import serializers
from .models import Report


class ViolationSerializer(serializers.Serializer):
    domain = serializers.ChoiceField(choices=['Worksite', 'Building'])
    category = serializers.CharField()
    detail = serializers.CharField()


class SendReportSerializer(serializers.Serializer):
    latitude = serializers.FloatField(required=False, allow_null=True, min_value=-90, max_value=90)
    longitude = serializers.FloatField(required=False, allow_null=True, min_value=-180, max_value=180)
    analysis_token = serializers.CharField()


class ReportSerializer(serializers.ModelSerializer):
    class Meta:
        model = Report
        fields = [
            'id', 'latitude', 'longitude', 'violations',
            'why_dangerous', 'urgency', 'complaint_draft', 'status', 'created_at',
        ]
