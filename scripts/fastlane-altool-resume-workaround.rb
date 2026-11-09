# Narrow compatibility workaround for Fastlane 2.232.2 + Apple's altool.
# Remove once the pinned Fastlane handles this diagnostic upstream.
#
# The pinned executor records every non-zero process exit as an additional error.
# Accept ONLY a zero-exit upload with an explicit success line and exclusively
# this exact resume-state diagnostic. Pilot still waits for Apple processing.
require 'fastlane_core/itunes_transporter' unless defined?(FastlaneCore::AltoolTransporterExecutor)

module RallyrooAltoolResumeWorkaround
  RESUME_ERROR = /\A\[ContentDelivery\.Uploader\.[A-Za-z0-9]+\] Failed to create URL for 'CDUploaderStateInfoResumeFilePath'\. The file (?:doesn’t|doesn't) exist\. \(4\) The file (?:doesn’t|doesn't) exist\.\z/.freeze

  def execute(command, hide_output, &block)
    accepted = super
    return accepted if accepted

    # Fail closed if the pinned executor's result/state contract changes.
    return rallyroo_reject('unexpected_executor_state') unless @all_lines.is_a?(Array) && @errors.is_a?(Array)
    success = @all_lines.any? do |record|
      rallyroo_plain_text(record).each_line.any? { |line| line.strip == 'UPLOAD SUCCEEDED with no errors' }
    end
    return rallyroo_reject('success_marker_absent') unless success
    return rallyroo_reject('no_diagnostic') if @errors.empty?
    return rallyroo_reject('additional_or_changed_error') unless @errors.all? do |error|
      RESUME_ERROR.match?(rallyroo_plain_text(error).strip)
    end

    @errors.clear
    FastlaneCore::UI.important('Ignoring known altool resume-state diagnostic after successful upload; Apple processing checks remain required.')
    true
  end

  private

  def rallyroo_plain_text(text)
    # altool/PTY output can be colored and an output record can contain several
    # physical lines. Normalize terminal SGR formatting, not message content.
    text.gsub(/\e\[[0-9;]*m/, '')
  end

  def rallyroo_reject(reason)
    # Fixed reason codes only: never emit raw uploader output or credentials.
    FastlaneCore::UI.important("altool resume workaround declined: #{reason}")
    false
  end
end

FastlaneCore::AltoolTransporterExecutor.prepend(RallyrooAltoolResumeWorkaround)
