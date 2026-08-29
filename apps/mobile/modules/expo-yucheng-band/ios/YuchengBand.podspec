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
  # The real vendor binaries ARE now committed here (YCProductSDK.framework
  # plus its 10 Jieli/Realtek/ZipZap dependencies), so this glob vendors them
  # as-is. NOTE: YCProductSDK.framework ships an arm64-apple-ios slice ONLY —
  # there is no arm64-apple-ios-simulator slice — so anything linking this pod
  # builds and runs on a PHYSICAL DEVICE only; an iOS Simulator build will
  # fail to link. Confirmed by inspecting the framework's
  # Modules/YCProductSDK.swiftmodule/ directory, which contains only
  # arm64-apple-ios.{swiftinterface,swiftmodule}.
  s.vendored_frameworks = 'Frameworks/*.framework'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES'
  }
end
