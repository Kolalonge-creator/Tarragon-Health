require 'json'

package = JSON.parse(File.read(File.join(__dir__, '..', 'package.json')))

Pod::Spec.new do |s|
  s.name           = 'YuchengBand'
  s.version        = package['version']
  s.summary        = package['description']
  s.license        = 'UNLICENSED'
  s.author         = 'Tarragon Health'
  s.homepage       = 'https://tarragonhealth.ng'
  s.platforms      = { ios: '15.1' } # matches ios/Podfile's platform :ios line
  s.swift_version  = '5.9'
  # No s.source — this pod is only ever consumed via Podfile `:path`
  # autolinking (see expo-module.config.json), which doesn't need one.
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.source_files = 'YuchengBandModule.swift'

  # Deliberately a glob, not a hardcoded framework list — see Frameworks/README.md.
  # This repo does not (yet) contain the actual vendor binaries; `pod install`
  # will vendor whatever .framework bundles are physically present in this
  # directory once someone drops them in per that README's instructions. An
  # empty Frameworks/ makes this a source-only pod that won't build against
  # the real SDK (import YCProductSDK will fail) but won't break `pod install`
  # itself or anything else in the workspace either.
  s.vendored_frameworks = 'Frameworks/*.framework'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES'
  }
end
