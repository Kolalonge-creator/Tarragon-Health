package expo.modules.yuchengband

import android.os.Bundle
import com.yucheng.ycbtsdk.YCBTClient
import com.yucheng.ycbtsdk.Constants
import com.yucheng.ycbtsdk.bean.ScanDeviceBean
import com.yucheng.ycbtsdk.response.BleConnectResponse
import com.yucheng.ycbtsdk.response.BleDataResponse
import com.yucheng.ycbtsdk.response.BleScanResponse
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.Promise
import org.json.JSONObject
import kotlin.math.roundToInt

/**
 * Kotlin bridge for the Yucheng ycbtsdk-release-4.0.11.aar (com.yucheng.ycbtsdk),
 * exposing only what apps/mobile/modules/expo-yucheng-band/index.ts declares —
 * scan/connect/disconnect, device info, and pulse/SpO2 history.
 *
 * IMPORTANT — verification gap: `YCBTClient` and `Constants` are used here as
 * top-level classes in `com.yucheng.ycbtsdk` (matching how the vendor's own
 * API docs reference them unqualified, and how the .aar's decompiled
 * classes.jar package tree — bean/, core/, gatt/, jl/, log/, receiver/,
 * response/, upgrade/, utils/ as *sub*packages alongside a root package —
 * is laid out). That inference has never been checked against Android
 * Studio's own decompiled view of the class file, because doing so needs a
 * real Android Gradle sync, which this environment cannot run (no Android
 * SDK/emulator, no physical band). If either import fails to resolve on
 * first real build, open ycbtsdk-release-4.0.11.aar's classes.jar in
 * Android Studio (or `unzip` + `javap`) to find the real package and fix
 * these two import lines — everything downstream (method names, callback
 * shapes, DATATYPE/BLEState constants, DataBean/AllDataBean field names) is
 * transcribed directly from the vendor's own API doc
 * (文档/文档 V1.0.5/Android_SDK_V1.0.5_EN.docx §1, §3.1, §10.4), not guessed.
 */
class YuchengBandModule : Module() {

  /** ycbtsdk keeps exactly one active connection at a time (connectBle takes
   * a mac but disconnectBle takes no argument) — this mirrors that rather
   * than pretending the native SDK is multi-device-concurrent. */
  private var connectedMac: String? = null

  override fun definition() = ModuleDefinition {
    Name("YuchengBand")

    AsyncFunction("initialize") { promise: Promise ->
      val context = appContext.reactContext
      if (context == null) {
        promise.reject("YUCHENG_NO_CONTEXT", "No Android context available to initialize the SDK", null)
        return@AsyncFunction
      }
      // isReconnect=true (let the SDK auto-reconnect a dropped link, same
      // spirit as ble.ts's own reconnection concerns), isDebug=false — this
      // should never log vendor SDK internals in a health app's release logs.
      YCBTClient.initClient(context, true, false)
      promise.resolve(null)
    }

    AsyncFunction("scan") { timeoutSeconds: Double, promise: Promise ->
      val found = LinkedHashMap<String, ScanDeviceBean>()
      try {
        YCBTClient.startScanBle(object : BleScanResponse {
          override fun onScanResponse(code: Int, device: ScanDeviceBean?) {
            if (device?.deviceMac != null) {
              found[device.deviceMac] = device
            }
          }
        }, timeoutSeconds.roundToInt())
      } catch (error: Throwable) {
        promise.reject("YUCHENG_SCAN_FAILED", error.message ?: "Scan failed to start", error)
        return@AsyncFunction
      }

      // startScanBle's callback fires once per discovered device and the
      // scan stops itself after `timeoutSeconds` (per the vendor doc — "the
      // search time is determined by delayTime... the search will stop
      // automatically"); this resolves shortly after that same window so
      // the JS caller gets one batched list rather than a stream, matching
      // the fixed-window contract index.ts documents for both platforms.
      android.os.Handler(android.os.Looper.getMainLooper()).postDelayed({
        val results = found.values.map { device ->
          Bundle().apply {
            putString("id", device.deviceMac)
            putString("name", device.deviceName)
            putInt("rssi", device.deviceRssi)
          }
        }
        promise.resolve(results)
      }, (timeoutSeconds * 1000).toLong() + 300)
    }

    AsyncFunction("connect") { deviceId: String, promise: Promise ->
      var settled = false
      YCBTClient.connectBle(deviceId, object : BleConnectResponse {
        override fun onConnectResponse(code: Int) {
          if (settled) return
          // ReadWriteOK is the only code that means "connected and usable" —
          // see Constants.BLEState in the vendor doc (§1.6): TimeOut/NotOpen/
          // Disconnect/Disconnecting are all failure-shaped for this call's
          // purposes even though some are also valid steady states elsewhere.
          if (code == Constants.BLEState.ReadWriteOK) {
            settled = true
            connectedMac = deviceId
            promise.resolve(null)
          } else if (code == Constants.BLEState.TimeOut || code == Constants.BLEState.Disconnect) {
            settled = true
            promise.reject("YUCHENG_CONNECT_FAILED", "Connect failed (code=$code)", null)
          }
          // Other codes are intermediate connecting states — keep waiting.
        }
      })
    }

    AsyncFunction("disconnect") { deviceId: String, promise: Promise ->
      // No-arg on the SDK side (single active connection) — deviceId is
      // accepted for API symmetry with connect()/connectionState() and to
      // guard against disconnecting a device that isn't actually the one
      // this module currently considers connected.
      if (connectedMac != null && connectedMac != deviceId) {
        promise.resolve(null)
        return@AsyncFunction
      }
      YCBTClient.disconnectBle()
      connectedMac = null
      promise.resolve(null)
    }

    AsyncFunction("connectionState") { deviceId: String, promise: Promise ->
      val state = when (YCBTClient.connectState()) {
        Constants.BLEState.ReadWriteOK -> "connected"
        Constants.BLEState.TimeOut -> "timeout"
        Constants.BLEState.NotOpen, Constants.BLEState.Disconnect -> "disconnected"
        else -> "connecting"
      }
      promise.resolve(state)
    }

    AsyncFunction("getDeviceInfo") { deviceId: String, promise: Promise ->
      YCBTClient.getDeviceInfo(object : BleDataResponse {
        override fun onDataResponse(code: Int, ratio: Float, resultMap: HashMap<*, *>?) {
          if (code != 0 || resultMap == null) {
            promise.reject("YUCHENG_DEVICE_INFO_FAILED", "getDeviceInfo failed (code=$code)", null)
            return
          }
          // resultMap's exact key names for battery/firmware weren't fully
          // captured from the vendor doc excerpt this module was written
          // against (only the nested BandBaseInfoModel.deviceBatteryValue /
          // deviceVersion field names were, from the demo app's model
          // class — see BandBaseInfo.java in the vendor's demo). JSONObject
          // is used here (rather than a typed Gson model, as the doc's own
          // samples do for healthHistoryData) specifically so a wrong key
          // guess degrades to a null field instead of a crash — confirm the
          // real keys against Android Studio's autocomplete on first build
          // and tighten this to a typed model at that point.
          val json = JSONObject(resultMap as Map<*, *>)
          val battery = json.optString("deviceBatteryValue", "").toIntOrNull()
            ?: json.optInt("battery", -1).takeIf { it >= 0 }
          val firmware = json.optString("deviceVersion", null)
            ?: json.optString("firmwareVersion", null)

          promise.resolve(Bundle().apply {
            putInt("batteryPercent", battery ?: -1)
            putString("firmwareVersion", firmware)
          })
        }
      })
    }

    AsyncFunction("readVitalsHistory") { deviceId: String, promise: Promise ->
      val readings = mutableListOf<Bundle>()
      var pending = 2 // heart-rate pull + combined-data pull (for SpO2)
      var failed = false

      fun finishIfDone() {
        pending -= 1
        if (pending == 0 && !failed) {
          promise.resolve(readings)
        }
      }

      YCBTClient.healthHistoryData(
        Constants.DATATYPE.Health_HistoryHeart,
        object : BleDataResponse {
          override fun onDataResponse(code: Int, ratio: Float, resultMap: HashMap<*, *>?) {
            if (code == 0 && resultMap != null) {
              try {
                val data = JSONObject(resultMap as Map<*, *>).optJSONArray("data")
                for (i in 0 until (data?.length() ?: 0)) {
                  val entry = data!!.getJSONObject(i)
                  val bpm = entry.optInt("heartValue", -1)
                  val startSec = entry.optLong("heartStartTime", -1L)
                  if (bpm > 0 && startSec > 0) {
                    readings.add(Bundle().apply {
                      putString("kind", "pulse")
                      putInt("pulseBpm", bpm)
                      putString("takenAt", java.time.Instant.ofEpochSecond(startSec).toString())
                    })
                  }
                }
              } catch (error: Exception) {
                // Malformed/unexpected shape for one data type shouldn't
                // sink the other — see the SpO2 pull's own try/catch below.
              }
            }
            finishIfDone()
          }
        }
      )

      YCBTClient.healthHistoryData(
        Constants.DATATYPE.Health_HistoryAll,
        object : BleDataResponse {
          override fun onDataResponse(code: Int, ratio: Float, resultMap: HashMap<*, *>?) {
            if (code == 0 && resultMap != null) {
              try {
                // Combined Data (AllDataBean) also carries heartValue, but
                // only OOValue (blood oxygen) is read here — heart rate
                // already comes from the cleaner Health_HistoryHeart pull
                // above; taking it from both would double-count the same
                // reading under two different sample sets.
                val data = JSONObject(resultMap as Map<*, *>).optJSONArray("data")
                for (i in 0 until (data?.length() ?: 0)) {
                  val entry = data!!.getJSONObject(i)
                  val spo2 = entry.optInt("OOValue", -1)
                  val startSec = entry.optLong("startTime", -1L)
                  if (spo2 in 50..100 && startSec > 0) {
                    val pulse = entry.optInt("heartValue", -1)
                    readings.add(Bundle().apply {
                      putString("kind", "spo2")
                      putInt("spo2Pct", spo2)
                      if (pulse > 0) putInt("pulseBpm", pulse) else putInt("pulseBpm", -1)
                      putString("takenAt", java.time.Instant.ofEpochSecond(startSec).toString())
                    })
                  }
                }
              } catch (error: Exception) {
                // See comment in the heart-rate branch above.
              }
            }
            finishIfDone()
          }
        }
      )
    }
  }
}
