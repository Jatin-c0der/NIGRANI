import hashlib
from django.core import signing

TOKEN_SALT = 'nigrani.analysis-binding'
TOKEN_MAX_AGE_SECONDS = 15 * 60


def _image_hash(image_bytes):
    return hashlib.sha256(image_bytes).hexdigest()


def issue_analysis_token(image_bytes, analysis):
    payload = {
        'image_hash': _image_hash(image_bytes),
        'violations': analysis['violations'],
        'why_dangerous': analysis['why_dangerous'],
        'urgency': analysis['urgency'],
        'complaint_draft': analysis['complaint_draft'],
    }
    return signing.dumps(payload, salt=TOKEN_SALT)


def verify_analysis_token(token, image_bytes):
    try:
        payload = signing.loads(token, salt=TOKEN_SALT, max_age=TOKEN_MAX_AGE_SECONDS)
    except signing.BadSignature:
        return None, 'Invalid or tampered analysis token.'
    except signing.SignatureExpired:
        return None, 'Analysis token has expired. Please re-analyze the image.'

    if payload['image_hash'] != _image_hash(image_bytes):
        return None, 'Uploaded image does not match the analyzed image.'

    return payload, None
