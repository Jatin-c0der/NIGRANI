from django.urls import path
from .views import AnalyzeView, SendView, ReportListView

urlpatterns = [
    path('analyze/', AnalyzeView.as_view(), name='analyze'),
    path('send/', SendView.as_view(), name='send'),
    path('', ReportListView.as_view(), name='report-list'),
]
