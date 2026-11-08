# Run with ruby scripts/test_fastlane_altool_resume.rb.
# Optional FASTLANE_TRANSPORTER_SOURCE runs these cases against the actual
# pinned upstream executor source, without installing gems or calling Apple.
require 'minitest/autorun'
require 'stringio'

module FastlaneCore
  class TransporterExecutor; end
  module Helper
    def self.test?; false; end
  end
  module UI
    def self.important(*); end
    def self.success(*); end
    def self.message(*); end
    def self.error(*); end
    def self.verbose(*); end
  end
  module FastlanePty
    class << self
      attr_accessor :fixture_output, :fixture_exit
      def spawn(command)
        raise 'Tests must not execute a real command' unless command == 'fixture-only'
        yield StringIO.new(fixture_output), nil, nil
        fixture_exit
      end
    end
  end
end

if ENV['FASTLANE_TRANSPORTER_SOURCE']
  source = File.read(ENV.fetch('FASTLANE_TRANSPORTER_SOURCE'))
  start = source.index('  class AltoolTransporterExecutor') or raise 'Missing upstream class'
  finish = source.index("\n  end", start) + "\n  end".length
  eval("module FastlaneCore\n" + source[start...finish] + "\nend", TOPLEVEL_BINDING, 'upstream_executor.rb')
else
  # Minimal upstream contract fixture. The optional integration mode above uses
  # the real 2.232.2 implementation for parser/exit-status verification.
  module FastlaneCore
    class AltoolTransporterExecutor
      attr_reader :errors
      def execute(command, hide_output)
        @errors = []
        @all_lines = []
        status = FastlanePty.spawn(command) do |stdout, stdin, pid|
          stdout.each_line do |line|
            @all_lines << line
            match = /(?:\*\*\*\s*)?ERROR:\s+(.+)/i.match(line)
            @errors << match[1] if match
          end
        end
        @errors << "The call to the altool completed with a non-zero exit status: #{status}. This indicates a failure." unless status.zero?
        yield @all_lines if block_given?
        @errors.empty?
      end
    end
  end
end

require_relative 'fastlane-altool-resume-workaround' unless ENV['WITHOUT_RESUME_WORKAROUND'] == '1'

class AltoolResumeTests < Minitest::Test
  DIAGNOSTIC = "ERROR: [ContentDelivery.Uploader.78E70892C0] Failed to create URL for 'CDUploaderStateInfoResumeFilePath'. The file doesn’t exist. (4) The file doesn’t exist.\n".freeze
  SUCCESS = "UPLOAD SUCCEEDED with no errors\n".freeze

  def execute(output, status = 0, &block)
    FastlaneCore::FastlanePty.fixture_output = output
    FastlaneCore::FastlanePty.fixture_exit = status
    executor = FastlaneCore::AltoolTransporterExecutor.new
    [executor.execute('fixture-only', true, &block), executor.errors]
  end

  def test_known_resume_diagnostic_with_success_is_accepted
    accepted, errors = execute(DIAGNOSTIC + SUCCESS)
    assert accepted
    assert_empty errors
  end

  def test_ascii_apostrophe_and_duplicate_diagnostic
    accepted, = execute(DIAGNOSTIC.gsub('’', "'") * 2 + SUCCESS)
    assert accepted
  end

  def test_resume_diagnostic_without_success_is_rejected
    accepted, = execute(DIAGNOSTIC)
    refute accepted
  end

  def test_nonzero_exit_is_rejected_even_with_success_marker
    [1, -1].each do |status|
      accepted, errors = execute(DIAGNOSTIC + SUCCESS, status)
      refute accepted
      refute_empty errors
    end
  end

  def test_other_errors_are_not_ignored
    accepted, = execute(DIAGNOSTIC + "ERROR: Authentication failed (401)\n" + SUCCESS)
    refute accepted
  end

  def test_similar_but_different_missing_file_is_rejected
    accepted, = execute(DIAGNOSTIC.sub('CDUploaderStateInfoResumeFilePath', 'RequiredIPAFilePath') + SUCCESS)
    refute accepted
  end

  def test_normal_success_and_callback_are_preserved
    lines = nil
    accepted, = execute(SUCCESS) { |output| lines = output }
    assert accepted
    assert_equal [SUCCESS], lines
  end
end
