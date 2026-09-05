#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
ruby -ryaml -e '
  w = YAML.load_file(".github/workflows/testflight.yml")
  triggers = w["on"] || w[true]
  abort "Wrong CI dependency" unless triggers["workflow_run"]["workflows"] == ["iOS"]
  abort "Wrong branch" unless triggers["workflow_run"]["branches"] == ["main"]
  abort "Missing recovery schedule" unless triggers["schedule"]
  abort "Uploads must not cancel" unless w["concurrency"]["cancel-in-progress"] == false
  job = w["jobs"]["plan"]
  abort "Missing success gate" unless job["if"].include?("conclusion == '\''success'\''")
  abort "Missing trusted push gate" unless job["if"].include?("event == '\''push'\''")
  w["jobs"].values.flat_map { |j| j["steps"] }.each do |step|
    next unless step["run"]
    abort "Shell expression interpolation" if step["run"].include?("${{")
    IO.popen(["bash", "-n"], "w") { |io| io.write(step["run"]) }
    abort "Invalid shell" unless $?.success?
  end
'
python3 -B -m unittest discover -s scripts -p 'test_*testflight*.py'
python3 - <<'PY'
from pathlib import Path
source = Path('scripts/upload-testflight.py').read_text()
fastfile = source.split("(fastlane_dir / \"Fastfile\").write_text('''", 1)[1].split("''')", 1)[0]
assert 'skip_submission: true' in fastfile, 'TestFlight must explicitly skip beta submission'
assert 'groups:' not in fastfile, 'Named groups can invoke external beta review'
assert 'distribute_external' not in fastfile, 'Automation must not perform distribution'
assert 'submit_for_review' not in fastfile, 'Automation must not submit for review'
PY
echo 'TestFlight workflow contract passed'
