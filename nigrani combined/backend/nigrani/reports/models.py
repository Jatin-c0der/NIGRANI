import uuid
from django.core.validators import MinValueValidator, MaxValueValidator
from django.db import models


class Report(models.Model):
    URGENCY_CHOICES = [
        ('Critical', 'Critical'),
        ('High', 'High'),
        ('Medium', 'Medium'),
    ]
    STATUS_CHOICES = [
        ('Pending', 'Pending'),
        ('Sent', 'Sent'),
        ('Failed', 'Failed'),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    latitude = models.FloatField(
        null=True, blank=True,
        validators=[MinValueValidator(-90), MaxValueValidator(90)],
    )
    longitude = models.FloatField(
        null=True, blank=True,
        validators=[MinValueValidator(-180), MaxValueValidator(180)],
    )
    violations = models.JSONField()
    why_dangerous = models.TextField()
    urgency = models.CharField(max_length=10, choices=URGENCY_CHOICES)
    complaint_draft = models.TextField()
    status = models.CharField(max_length=10, choices=STATUS_CHOICES, default='Sent')
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']
