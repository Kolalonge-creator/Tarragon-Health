package expo.modules.yuchengband

import android.bluetooth.BluetoothDevice
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
 * Verified 2026-08-28 against the real compiled classes (`javap` on the
 * decompiled ycbtsdk-release-4.0.11.aar), after a real EAS Android build
 * caught a genuine mismatch between the vendor's own doc and what actually
 * shipped in this version: the doc's "YCBTClient.connectBle(mac,
 * bleConnectResponse)" does not exist in 4.0.11 at all — the real connect
 * method is `connectBleDevice(BluetoothDevice, BleConnectResponse): Boolean`,
 * taking the actual Android BluetoothDevice object (from ScanDeviceBean's
 * public `device` field), not a MAC string. Fixed below by caching the
 * BluetoothDevice objects scan() sees, same pattern the iOS module already
 * uses for CBPeripheral. Everything else in this file — YCBTClient and
 * Constants living directly in com.yucheng.ycbtsdk, the BleScanResponse/
 * BleConnectResponse/BleDataResponse callback shapes, initClient/
 * getDeviceInfo/healthHistoryData signatures, DATATYPE/BLEState constants —
 * was checked the same way and matched the doc exactly; only the connect
 * call itself was stale in the vendor's documentation.
 */
class YuchengBandModule : Module() {

  /** ycbtsdk keeps exactly one active connection at a time (connectBleDevice
   * takes a device but disconnectBle takes no argument) — this mirrors that
   * rather than pretending the native SDK is multi-device-concurrent. */
  private var connectedMac: String? = null

  /** BluetoothDevice objects seen during scan(), keyed by MAC — connect()
   * needs the actual object, not just the address string (see header). */
  private val discoveredDevices = LinkedHashMap<String, BluetoothDevice>()

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
              device.device?.let { discoveredDevices[device.deviceMac] = it }
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
      val bluetoothDevice = discoveredDevices[deviceId]
      if (bluetoothDevice == null) {
        promise.reject("YUCHENG_UNKNOWN_DEVICE", "Call scan() before connect() — no cached device for $deviceId", null)
        return@AsyncFunction
      }

      var settled = false
      // connectBleDevice returns false when it couldn't even start (e.g. the
      // SDK is already mid-connect elsewhere) — that's a synchronous failure,
      // distinct from onConnectResponse's async TimeOut/Disconnect codes.
      val started = YCBTClient.connectBleDevice(bluetoothDevice, object : BleConnectResponse {
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
      if (!started) {
        promise.reject("YUCHENG_CONNECT_FAILED", "connectBleDevice did not start (code=${YCBTClient.getLastConnectErrorCode()})", null)
      }
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
          // Key names CONFIRMED against the shipped ycbtsdk-release-4.0.11.aar
          // rather than the vendor doc: com.yucheng.ycbtsdk.core.DataUnpack is
          // the class that populates this resultMap, and its constant pool
          // carries "deviceBatteryValue" and "deviceVersion" (alongside
          // deviceMainVersion/deviceSubVersion/deviceBatteryState/deviceId/
          // deviceType/devicetBindState). So the two keys read below are the
          // real ones, not guesses.
          //
          // The former "firmwareVersion" fallback was removed: that string
          // appears nowhere in the SDK's bytecode, so it was unreachable.
          // The "battery" fallback is kept — that key does exist in DataUnpack,
          // just on other message types, and costs nothing here.
          //
          // JSONObject (rather than a typed Gson model) is still deliberate:
          // optString/optInt degrade an unexpected shape to a null/-1 field
          // instead of crashing mid-sync. optString also coerces a numeric
          // value to its string form, so deviceBatteryValue parses whether the
          // SDK boxes it as an Int or a String.
          val json = JSONObject(resultMap as Map<*, *>)
          val battery = json.optString("deviceBatteryValue", "").toIntOrNull()
            ?: json.optInt("battery", -1).takeIf { it >= 0 }
          val firmware = json.optString("deviceVersion", null)

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
