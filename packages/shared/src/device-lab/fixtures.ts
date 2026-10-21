/**
 * Representative adb / simctl output used only by tests. Shapes follow real Android 10 to 14 output; the values are made up. They are fixtures
 * for the parsers, NOT measurements of any phone.
 */
export const ADB_DEVICES = `List of devices attached
* daemon not running; starting now at tcp:5037
* daemon started successfully
R58M12ABCDE\tdevice usb:1-1 product:KG5k model:TECNO_KG5k device:TECNO-KG5k transport_id:2
emulator-5554\toffline
ZY22XXXXXX\tunauthorized usb:1-2 transport_id:3
`;

export const AM_START_COLD = `Starting: Intent { act=android.intent.action.MAIN cat=[android.intent.category.LAUNCHER] cmp=com.tarragonhealth.app/.MainActivity }
Status: ok
LaunchState: COLD
Activity: com.tarragonhealth.app/.MainActivity
TotalTime: 2410
WaitTime: 2433
Complete
`;

export const amStartCold = (ms: number): string => AM_START_COLD.replace("TotalTime: 2410", `TotalTime: ${ms}`);

export const AM_START_HOT = `Starting: Intent { act=android.intent.action.MAIN cmp=com.tarragonhealth.app/.MainActivity }
Status: ok
LaunchState: HOT
Activity: com.tarragonhealth.app/.MainActivity
TotalTime: 180
WaitTime: 181
Complete
`;

export const AM_START_OLD_ANDROID = `Starting: Intent { act=android.intent.action.MAIN cmp=com.tarragonhealth.app/.MainActivity }
Status: ok
Activity: com.tarragonhealth.app/.MainActivity
ThisTime: 3010
TotalTime: 3010
WaitTime: 3025
Complete
`;

export const AM_START_NOT_STARTED = `Starting: Intent { cmp=com.tarragonhealth.app/.MainActivity }
Warning: Activity not started, its current task has been brought to the front
Status: ok
LaunchState: HOT
Activity: com.tarragonhealth.app/.MainActivity
TotalTime: 0
WaitTime: 4
Complete
`;

export const AM_START_ERROR = `Starting: Intent { cmp=com.tarragonhealth.app/.MainActivity }
Error type 3
Error: Activity class {com.tarragonhealth.app/com.tarragonhealth.app.MainActivity} does not exist.
`;

export const RESOLVE_ACTIVITY = `priority=0 preferredOrder=0 match=0x108000 specificIndex=-1 isDefault=true
com.tarragonhealth.app/.MainActivity
`;

export const MEMINFO_MODERN = `Applications Memory Usage (in Kilobytes):
Uptime: 1234567 Realtime: 1234567

** MEMINFO in pid 12345 [com.tarragonhealth.app] **
                   Pss  Private  Private  SwapPss      Rss     Heap     Heap     Heap
                 Total    Dirty    Clean    Dirty    Total     Size    Alloc     Free
                ------   ------   ------   ------   ------   ------   ------   ------
  Native Heap    30112    30040        0      120    34000    50000    38000    12000
  Dalvik Heap     9000     8900        0       50    14000    20000    12000     8000
        TOTAL   141024   120000     9000     2000   201234    70000    50000    20000

 App Summary
                       Pss(KB)                        Rss(KB)
                        ------                         ------
           Java Heap:     9500                          14000
         Native Heap:    30040                          34000
                TOTAL PSS:   141024            TOTAL RSS:   201234       TOTAL SWAP PSS:     2000
`;

export const MEMINFO_LEGACY = `Applications Memory Usage (in kB):
** MEMINFO in pid 999 [com.tarragonhealth.app] **
                   Pss  Private  Private  Swapped     Heap     Heap     Heap
                 Total    Dirty    Clean    Dirty     Size    Alloc     Free
  Native Heap    20000    19900        0        0    30000    22000     8000
        TOTAL    98765    90000     5000        0    50000    30000    14000
`;

export const MEMINFO_NO_PROCESS = `Applications Memory Usage (in kB):
No process found for: com.tarragonhealth.app
`;

export const PM_PATH_SPLITS = `package:/data/app/~~abc==/com.tarragonhealth.app-xyz==/base.apk
package:/data/app/~~abc==/com.tarragonhealth.app-xyz==/split_config.arm64_v8a.apk
`;

export const STAT_SIZES = `31457280
6291456
`;

export const GETPROP = `[ro.product.manufacturer]: [TECNO]
[ro.product.model]: [TECNO KG5k]
[ro.build.version.release]: [11]
[ro.build.version.sdk]: [30]
[ro.hardware]: [mt6762]
[ro.kernel.qemu]: []
`;

export const GETPROP_EMULATOR = `[ro.product.manufacturer]: [Google]
[ro.product.model]: [sdk_gphone64_arm64]
[ro.build.version.release]: [14]
[ro.build.version.sdk]: [34]
[ro.hardware]: [ranchu]
[ro.kernel.qemu]: [1]
`;

export const PROC_MEMINFO = `MemTotal:        1873456 kB
MemFree:           90000 kB
`;

export const DUMPSYS_PACKAGE_RELEASE = `Packages:
  Package [com.tarragonhealth.app] (abc123):
    versionCode=42 minSdk=24 targetSdk=35
    versionName=0.2.0
    flags=[ HAS_CODE ALLOW_CLEAR_USER_DATA ALLOW_BACKUP ]
    privateFlags=[ PRIVATE_FLAG_ACTIVITIES_RESIZE_MODE_RESIZEABLE_VIA_SDK_VERSION ]
`;

export const DUMPSYS_PACKAGE_DEBUG = `Packages:
  Package [com.tarragonhealth.app] (abc123):
    versionCode=42 minSdk=24 targetSdk=35
    versionName=0.2.0
    flags=[ DEBUGGABLE HAS_CODE ALLOW_CLEAR_USER_DATA ]
`;

export const DUMPSYS_PACKAGE_OLD_FLAGS = `Packages:
  Package [com.tarragonhealth.app] (abc123):
    versionCode=7 minSdk=21
    versionName=0.1.0
    pkgFlags=[ DEBUGGABLE HAS_CODE ]
`;

export const SIMCTL_BOOTED = JSON.stringify({
  devices: {
    "com.apple.CoreSimulator.SimRuntime.iOS-17-5": [
      { udid: "AAAA-1111", name: "iPhone 15", state: "Booted" },
      { udid: "BBBB-2222", name: "iPhone SE", state: "Shutdown" },
    ],
  },
});

export const UI_DUMP_WAITING = `<?xml version='1.0' encoding='UTF-8' standalone='yes' ?>
<hierarchy rotation="0"><node index="0" text="" class="android.widget.FrameLayout" package="com.tarragonhealth.app"><node text="Saved on this phone, waiting to send: 3" class="android.widget.TextView" /></node></hierarchy>
UI hierarchy dumped to: /dev/tty`;

export const UI_DUMP_CLEAR = `<?xml version='1.0' encoding='UTF-8' standalone='yes' ?>
<hierarchy rotation="0"><node index="0" text="" class="android.widget.FrameLayout" package="com.tarragonhealth.app"><node text="Save reading" class="android.widget.Button" /></node></hierarchy>
UI hierarchy dumped to: /dev/tty`;

export const FOCUS_APP = "  mCurrentFocus=Window{4f2a1c u0 com.tarragonhealth.app/com.tarragonhealth.app.MainActivity}\n";
export const FOCUS_LAUNCHER = "  mCurrentFocus=Window{9a8b7c u0 com.android.launcher3/com.android.launcher3.Launcher}\n";
export const FOCUS_NONE = "  mCurrentFocus=null\n";

export const UI_DUMP_DELIVERED = `<?xml version='1.0' encoding='UTF-8' standalone='yes' ?>
<hierarchy rotation="0"><node index="0" text="" class="android.widget.FrameLayout" package="com.tarragonhealth.app"><node text="Received by TarragonHealth." class="android.widget.TextView" /><node text="Save reading" class="android.widget.Button" /></node></hierarchy>
UI hierarchy dumped to: /dev/tty`;

export const UI_DUMP_REJECTED = `<?xml version='1.0' encoding='UTF-8' standalone='yes' ?>
<hierarchy rotation="0"><node index="0" text="" class="android.widget.FrameLayout" package="com.tarragonhealth.app"><node text="3 could not be saved. Your care team has not received it. Tell support this code: X1" class="android.widget.TextView" /></node></hierarchy>
UI hierarchy dumped to: /dev/tty`;
