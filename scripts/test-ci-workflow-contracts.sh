#!/usr/bin/env bash
set -Eeuo pipefail
cd "$(dirname "$0")/.."
ruby -ryaml - <<'RUBY'
def require_contract(condition, message)
  abort message unless condition
end

def runs(job)
  job.fetch('steps').map { |step| step['run'] }.compact.join("\n")
end

def needs(job)
  Array(job['needs'])
end

workflows = Dir['.github/workflows/*.yml'].to_h { |path| [File.basename(path, '.yml'), YAML.load_file(path)] }
workflows.each_value do |workflow|
  workflow.fetch('jobs').each_value do |job|
    Array(job['steps']).each do |step|
      next unless step['run']
      IO.popen(['bash', '-n'], 'w') { |io| io.write(step['run']) }
      require_contract($?.success?, 'Workflow contains invalid shell')
    end
  end
end

ios = workflows.fetch('ios')
triggers = ios['on'] || ios[true]
require_contract(triggers.key?('pull_request'), 'Required iOS checks must report on every PR')
jobs = ios.fetch('jobs')
gate = jobs.fetch('verification')
require_contract(gate['if'] == 'always()', 'Final iOS gate must always report')
require_contract(needs(gate).sort == %w[changes core-contract delivery-contracts ui ui-narrow], 'Final gate dependencies incomplete')
base = {'CHANGES_RESULT' => 'success', 'IOS_CHANGED' => 'true', 'DELIVERY_CHANGED' => 'true',
        'CORE_RESULT' => 'success', 'UI_RESULT' => 'success', 'NARROW_RESULT' => 'success', 'DELIVERY_RESULT' => 'success'}
unrelated = base.merge('IOS_CHANGED' => 'false', 'DELIVERY_CHANGED' => 'false', 'CORE_RESULT' => 'skipped',
                       'UI_RESULT' => 'skipped', 'NARROW_RESULT' => 'skipped', 'DELIVERY_RESULT' => 'skipped')
[[base, true], [unrelated, true], [unrelated.merge('DELIVERY_CHANGED' => 'true', 'DELIVERY_RESULT' => 'success'), true],
 [base.merge('CHANGES_RESULT' => 'failure'), false], [base.merge('IOS_CHANGED' => ''), false],
 [base.merge('NARROW_RESULT' => 'failure'), false], [base.merge('CORE_RESULT' => 'skipped'), false],
 [base.merge('DELIVERY_RESULT' => 'cancelled'), false], [unrelated.merge('UI_RESULT' => 'success'), false]].each_with_index do |(env, expected), index|
  actual = system(env, 'bash', '-eo', 'pipefail', '-c', runs(gate), out: File::NULL, err: File::NULL)
  require_contract(actual == expected, "Final iOS gate mishandles success/failure/skip case #{index + 1}")
end
require_contract(runs(jobs.fetch('core-contract')).include?('tee "$RUNNER_TEMP/core-tests.log"'), 'Core XCTest records missing')
require_contract(runs(jobs.fetch('core-contract')).include?('set -o pipefail'), 'Core test exit status must survive tee')
require_contract(runs(jobs.fetch('core-contract')).include?('--format xctest-log'), 'Core execution inventory gate missing')
%w[ui ui-narrow].each do |name|
  job = jobs.fetch(name)
  require_contract(runs(job).include?('-resultBundlePath'), 'UI xcresult missing')
  require_contract(runs(job).include?('--format xcresult'), 'UI execution inventory gate missing')
  require_contract(job.fetch('steps').any? { |s| s['uses'].to_s.start_with?('actions/upload-artifact@') && s['if'] == 'always()' },
                   'UI failure diagnostics must be retained')
end
require_contract(runs(jobs.fetch('ui')).include?('verify-submission-assets.py'), 'Compiled privacy asset gate missing')
require_contract(runs(jobs.fetch('ui')).include?('--app "$RUNNER_TEMP/ios-derived/Build/Products/Debug-iphonesimulator/FamilyApp.app"'), 'Privacy gate must check built resources')
require_contract(runs(jobs.fetch('ui-narrow')).include?('iPhone-SE-3rd-generation'), 'Small-screen device missing')
require_contract(runs(jobs.fetch('ui-narrow')).include?('--selection scripts/ios-narrow-tests.txt'), 'Narrow inventory selection missing')
require_contract(jobs.fetch('delivery-contracts').fetch('runs-on').start_with?('macos-'), 'Signing lifecycle must run on macOS')
require_contract(runs(jobs.fetch('delivery-contracts')).include?('test-app-store-upload-workflow.sh'), 'macOS delivery tests missing')

release = workflows.fetch('release').fetch('jobs')
verify = release.fetch('verify')
require_contract(verify.fetch('services').keys.sort == %w[postgres redis], 'Release integration services incomplete')
%w[INTEGRATION_DATABASE_URL INTEGRATION_REDIS_URL].each do |name|
  require_contract(!verify.fetch('env').fetch(name).empty?, 'Release integration tests must not silently skip')
end
%w[test:integration test-backup-job.sh test-ci-http-contract.sh].each do |command|
  require_contract(runs(verify).include?(command), 'Release verification suite incomplete')
end
require_contract(needs(release.fetch('publish')).include?('verify'), 'Publication must require verification')
require_contract(needs(release.fetch('create-release')).include?('publish'), 'GitHub Release must wait for artifact publication')
require_contract(runs(workflows.fetch('api').fetch('jobs').fetch('http-contract')).include?('test-ci-http-contract.sh'), 'HTTP edge smoke missing')

[jobs.fetch('core-contract'), jobs.fetch('ui'), jobs.fetch('ui-narrow'), jobs.fetch('delivery-contracts'), verify].each do |job|
  require_contract(!job['continue-on-error'], 'Verification job may not ignore failures')
  require_contract(job.fetch('steps').none? { |step| step['continue-on-error'] }, 'Verification step may not ignore failures')
end
RUBY
python3 -B - <<'PY'
import importlib.util
from pathlib import Path
spec = importlib.util.spec_from_file_location('results', 'scripts/verify-xctest-results.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
expected = module.inventory(Path('clients/ios/FamilyAppUITests/FamilyAppUITests.swift'))
selected = Path('scripts/ios-narrow-tests.txt').read_text().splitlines()
assert selected and len(selected) == len(set(selected)), 'Empty/duplicate narrow selection'
assert all(f'FamilyAppUITests.{name}' in expected for name in selected), 'Stale narrow selection'
PY
echo 'CI contracts: execution inventory, small-screen coverage, macOS signing and release gates passed.'
