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
    return false unless @all_lines.is_a?(Array) && @errors.is_a?(Array)
    return false unless @all_lines.any? { |line| line.strip == 'UPLOAD SUCCEEDED with no errors' }
    return false if @errors.empty?
    return false unless @errors.all? { |error| RESUME_ERROR.match?(error.strip) }

    @errors.clear
    FastlaneCore::UI.important('Ignoring known altool resume-state diagnostic after successful upload; Apple processing checks remain required.')
    true
  end
end

FastlaneCore::AltoolTransporterExecutor.prepend(RallyrooAltoolResumeWorkaround)
