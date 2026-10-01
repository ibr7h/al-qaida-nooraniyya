"""Run before each release after changing audio, images, or lesson metadata."""
from pathlib import Path
import hashlib
import json
root = Path(__file__).resolve().parents[1]
files = sorted(f for folder in ['audio', 'images', 'content/lessons', 'audio_master']
               for f in (root / 'assets' / folder).rglob('*') if f.is_file())
revisions = {f.relative_to(root).as_posix(): hashlib.sha256(f.read_bytes()).hexdigest() for f in files}
(root / 'asset-revisions.json').write_text(json.dumps(revisions, indent=2) + '\n')
print(f'Indexed {len(revisions)} assets')
