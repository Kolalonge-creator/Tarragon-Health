require 'json'

package = JSON.parse(File.read(File.join(__dir__, '..', 'package.json')))

Pod::Spec.new do |s|
  s.name           = 'YuchengBand'
  s.version        = package['version']
  # CocoaPods caps summary at 140 chars and requires it distinct from the
  # longer description — package.json's own description (below) is the
  # detailed one, kept as s.description instead of overflowing s.summary.
  s.summary        = 'Local Expo module bridging the Yucheng YCBT/YCProductSDK vendor BLE SDK.'
  s.description    = package['description']
  s.license        = 'UNLICENSED'
  s.author         = 'Tarragon Health'
  s.homepage       = 'https://tarragonhealth.ng'
  s.platforms      = { ios: '15.1' } # matches ios/Podfile's platform :ios line
  s.swift_version  = '5.9'
  # Required by CocoaPods' spec validator even for a pod that's only ever
  # consumed via Podfile `:path` autolinking (see expo-module.config.json) —
  # confirmed the hard way: `pod install` itself refused to proceed with
  # "Missing required attribute `source`" until this was added, not just
  # `pod spec lint`. `:path => '.'` is the standard idiom for a pod with no
  # real remote to point at.
  s.source         = { path: '.' }
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
