package expo.modules.exactalarms

import android.app.AlarmManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Two questions about Android's exact-alarm permission (S08x, OQ-73), and nothing else:
 *  - may this app set exact alarms right now?
 *  - open the system screen where the person can allow it.
 * SCHEDULE_EXACT_ALARM only. USE_EXACT_ALARM is not used: Play restricts it to alarm and calendar apps.
 * Neither function throws into JavaScript; a failure answers false.
 */
class ExactAlarmsModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("ExactAlarms")

    Function("canScheduleExactAlarms") {
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) {
        true
      } else {
        try {
          val context = appContext.reactContext
          val alarms = context?.getSystemService(Context.ALARM_SERVICE) as? AlarmManager
          alarms?.canScheduleExactAlarms() ?: false
        } catch (e: Exception) {
          false
        }
      }
    }

    Function("openExactAlarmSettings") {
      try {
        val context = appContext.reactContext
        if (context == null || Build.VERSION.SDK_INT < Build.VERSION_CODES.S) {
          false
        } else {
          val intent = Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM, Uri.parse("package:" + context.packageName))
          intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
          context.startActivity(intent)
          true
        }
      } catch (e: Exception) {
        false
      }
    }
  }
}
