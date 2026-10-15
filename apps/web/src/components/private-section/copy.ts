/**
 * Words on the private section lock screens (S66). English only (decision D-14). These are proposed product copy, not clinical content.
 * No em dashes. The locked screen deliberately names nothing about what is inside.
 */
export const PRIVATE_SECTION_COPY = {
  loading: "Opening...",
  setupIntro: "This part of the app is private. Choose a PIN so that only you can open it on this device. You can turn this off if you prefer.",
  newPin: "New PIN",
  confirmPin: "Type it again",
  pinHelp: "Use {min} to {max} numbers. You will be asked for it each time you come back.",
  pinsDiffer: "The two PINs are not the same. Try again.",
  setPin: "Set PIN",
  saving: "Saving...",
  noLock: "No lock, thanks",
  storageFailed: "This device could not save your PIN. Try again, or turn the lock off.",
  unlockIntro: "Enter your PIN to open this part of the app.",
  enterPin: "PIN",
  open: "Open",
  wrongPin: "That PIN is not right. Try again.",
  lockedOut: "Too many tries. Wait {seconds} seconds and try again.",
  forgotPin: "I forgot my PIN",
  lockNow: "Lock now",
  turnOffLock: "Turn off the lock",
  turnOnLock: "Turn the lock on",
  recoveryTitle: "Reset your PIN",
  recoveryIntro: "We will send a code to the phone number on your account, or to your email if you have no phone. Nothing you have saved is lost: only the PIN on this device is cleared.",
  sendCode: "Send me a code",
  sending: "Sending...",
  codeLabel: "6 digit code",
  verifyCode: "Check code",
  checking: "Checking...",
  backToPin: "Back",
} as const;
