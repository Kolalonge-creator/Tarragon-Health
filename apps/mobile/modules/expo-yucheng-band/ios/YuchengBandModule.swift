import ExpoModulesCore
import CoreBluetooth
// This import only resolves once the real YCProductSDK.framework (and
// whatever dependency frameworks it needs) has been dropped into
// ../Frameworks per Frameworks/README.md — see that file. Until then this
// target will not build, which is the correct failure mode (loud at build
// time, not silent at runtime).
import YCProductSDK

/**
 * Swift bridge for YCProductSDK, exposing only what
 * apps/mobile/modules/expo-yucheng-band/index.ts declares. Method names and
 * shapes are transcribed from the vendor's own doc
 * (文档 V1.0.5/iOS_SDK_Swift_V2.0_EN.pdf, via the Google Drive copy) §3
 * (scan/connect/disconnect), §4 (queryHealthData + the YCHealthDataHeartRate/
 * YCHealthDataCombinedData result types), and §5 (queryDeviceBasicInfo) —
 * not guessed. Two things in here ARE inferred rather than doc-confirmed,
 * flagged inline where they occur: queryDeviceBasicInfo's full parameter
 * list (only its call-site example was captured, not its declaration), and
 * the absence of any direct "is this peripheral connected" query API (the
 * doc only showed connectDevice/disconnectDevice completions and
 * currentPeripheral, so connectionState() below approximates from that
 * rather than calling something that may not exist).
 *
 * Like the Android module, this has never been built or run — no macOS/
 * Xcode in the environment that wrote it, no physical band either.
 */
public class YuchengBandModule: Module {
  /// Keyed by CBPeripheral.identifier.uuidString, the id this module's JS
  /// API surface uses — CoreBluetooth doesn't let you reconstruct a
  /// CBPeripheral from a UUID string alone, so scan() results must be
  /// cached for connect()/disconnect() to look up later.
  private var discovered: [String: CBPeripheral] = [:]

  public func definition() -> ModuleDefinition {
    Name("YuchengBand")

    AsyncFunction("initialize") { (promise: Promise) in
      // No init/config call in this SDK's docs (unlike, say, an appId/
      // license-key setup) — resolves immediately so the JS-side contract
      // matches Android's, which does need one.
      promise.resolve(nil)
    }

    AsyncFunction("scan") { (timeoutSeconds: Double, promise: Promise) in
      YCProduct.scanningDevice(delayTime: timeoutSeconds) { [weak self] devices, error in
        guard let self = self else { return }
        if let error = error {
          promise.reject("YUCHENG_SCAN_FAILED", error.localizedDescription)
          return
        }
        var results: [[String: Any?]] = []
        for device in devices {
          let id = device.identifier.uuidString
          self.discovered[id] = device
          results.append([
            "id": id,
            "name": device.name,
            "rssi": nil, // scanningDevice's completion doesn't surface RSSI per the doc's signature — Android's does (ScanDeviceBean.deviceRssi), iOS's doesn't; left null rather than a fabricated value.
          ])
        }
        promise.resolve(results)
      }
    }

    AsyncFunction("connect") { (deviceId: String, promise: Promise) in
      guard let peripheral = self.discovered[deviceId] else {
        promise.reject("YUCHENG_UNKNOWN_DEVICE", "Call scan() before connect() — no cached peripheral for \(deviceId)")
        return
      }
      YCProduct.connectDevice(peripheral) { state, error in
        if state == .connected {
          promise.resolve(nil)
        } else {
          promise.reject("YUCHENG_CONNECT_FAILED", error?.localizedDescription ?? "Connect failed (state=\(state))")
        }
      }
    }

    AsyncFunction("disconnect") { (deviceId: String, promise: Promise) in
      let peripheral = self.discovered[deviceId] ?? YCProduct.shared.currentPeripheral
      YCProduct.disconnectDevice(peripheral) { _, _ in
        // Disconnect is treated as best-effort success either way, same as
        // ble.ts's own teardown path (cancelDeviceConnection().catch(() =>
        // undefined)) — a caller tearing down a screen shouldn't be blocked
        // by a disconnect that "fails" because the link was already down.
        promise.resolve(nil)
      }
    }

    AsyncFunction("connectionState") { (deviceId: String, promise: Promise) in
      // No direct "query connection state for peripheral X" API surfaced in
      // the vendor doc — approximated from currentPeripheral, which the SDK
      // documents as "the connected device" (singular, matching Android's
      // single-active-connection design). A stricter answer would need
      // YCProduct's own CBPeripheral delegate/state stream, which the doc
      // excerpt this module was written against didn't include.
      let isCurrent = YCProduct.shared.currentPeripheral?.identifier.uuidString == deviceId
      promise.resolve(isCurrent ? "connected" : "disconnected")
    }

    AsyncFunction("getDeviceInfo") { (deviceId: String, promise: Promise) in
      let peripheral = self.discovered[deviceId] ?? YCProduct.shared.currentPeripheral
      // Signature CONFIRMED against the shipped binary's
      // Frameworks/YCProductSDK.framework/Modules/YCProductSDK.swiftmodule/
      // arm64-apple-ios.swiftinterface, which declares:
      //   queryDeviceBasicInfo(_ peripheral: CBPeripheral? = YCProduct.shared
      //     .currentPeripheral, completion: ((YCProductState, Any?) -> ())?)
      // — i.e. the inferred shape this call was originally written against
      // was right. Verified by reading the .swiftinterface directly, not by
      // an Xcode build; see this file's header for what remains unverified.
      YCProduct.queryDeviceBasicInfo(peripheral) { state, response in
        guard state == .succeed, let info = response as? YCDeviceBasicInfo else {
          promise.reject("YUCHENG_DEVICE_INFO_FAILED", "queryDeviceBasicInfo failed (state=\(state))")
          return
        }
        // mcuFirmware is the band's main MCU firmware — the one a patient or
        // support agent means by "firmware version". YCDeviceBasicInfo also
        // carries innerProtocol/bloodPressureFirmware/touchPanelFirmware/
        // bloodGlucoseFirmware, all the same YCDeviceVersionInfo type; those
        // are per-subsystem versions, not the device's headline one, so they
        // are deliberately not surfaced through this module's single
        // firmwareVersion field. Field names confirmed against the shipped
        // YCProductSDK.framework .swiftinterface: YCDeviceBasicInfo
        // .mcuFirmware: YCDeviceVersionInfo, which exposes `version: String`
        // (alongside majorVersion/subVersion UInt8s).
        promise.resolve([
          "batteryPercent": Int(info.batteryPower),
          "firmwareVersion": info.mcuFirmware.version,
        ])
      }
    }

    AsyncFunction("readVitalsHistory") { (deviceId: String, promise: Promise) in
      let peripheral = self.discovered[deviceId] ?? YCProduct.shared.currentPeripheral
      var readings: [[String: Any?]] = []
      let group = DispatchGroup()
      let isoFormatter = ISO8601DateFormatter()

      group.enter()
      YCProduct.queryHealthData(peripheral, dataType: .heartRate) { state, response in
        defer { group.leave() }
        guard state == .succeed, let data = response as? [YCHealthDataHeartRate] else { return }
        for entry in data where entry.heartRate > 0 {
          let takenAt = isoFormatter.string(from: Date(timeIntervalSince1970: TimeInterval(entry.startTimeStamp)))
          readings.append(["kind": "pulse", "pulseBpm": entry.heartRate, "takenAt": takenAt])
        }
      }

      group.enter()
      // Combined Data also carries heartRate, but only bloodOxygen is read
      // here — pulse already comes from the cleaner .heartRate pull above,
      // same reasoning as the Android module's Health_HistoryAll handling.
      YCProduct.queryHealthData(peripheral, dataType: .combinedData) { state, response in
        defer { group.leave() }
        guard state == .succeed, let data = response as? [YCHealthDataCombinedData] else { return }
        for entry in data where entry.bloodOxygen >= 50 && entry.bloodOxygen <= 100 {
          let takenAt = isoFormatter.string(from: Date(timeIntervalSince1970: TimeInterval(entry.startTimeStamp)))
          var reading: [String: Any?] = ["kind": "spo2", "spo2Pct": entry.bloodOxygen, "takenAt": takenAt]
          if entry.heartRate > 0 {
            reading["pulseBpm"] = entry.heartRate
          }
          readings.append(reading)
        }
      }

      group.notify(queue: .main) {
        promise.resolve(readings)
      }
    }
  }
}
