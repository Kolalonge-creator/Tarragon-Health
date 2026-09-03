import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Modal, Pressable, ScrollView, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import {
  describeNotification,
  loadNotifications,
  markAllNotificationsRead,
  relativeTime,
  type InAppNotification,
} from "@/lib/notifications";
import { colors, inkAlpha } from "./theme";

interface TopBarProps {
  userId: string;
  patientName: string;
  initials: string;
  onOpenDrawer: () => void;
  onOpenSettings: () => void;
  onSignOut: () => void;
}

/** Hamburger + wordmark + notification bell + profile avatar — the header
 * mounted above every section of the signed-in app. */
export function TopBar({ userId, patientName, initials, onOpenDrawer, onOpenSettings, onSignOut }: TopBarProps) {
  const [notifOpen, setNotifOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [notifications, setNotifications] = useState<InAppNotification[]>([]);
  const [loadingNotifs, setLoadingNotifs] = useState(false);
  // A failed fetch must not render as "You're all caught up" — that's a
  // false claim on the one surface mounted on every screen. It also used to
  // be an unhandled rejection on an offline launch.
  const [notifError, setNotifError] = useState(false);
  const [markError, setMarkError] = useState(false);

  const hasUnread = notifications.some((n) => n.status !== "read");

  const refreshNotifications = useCallback(() => {
    setLoadingNotifs(true);
    loadNotifications(userId)
      .then((rows) => {
        setNotifications(rows);
        setNotifError(false);
      })
      .catch(() => setNotifError(true))
      .finally(() => setLoadingNotifs(false));
  }, [userId]);

  useEffect(() => {
    refreshNotifications();
  }, [refreshNotifications]);

  const handleMarkAllRead = useCallback(() => {
    setMarkError(false);
    markAllNotificationsRead(userId)
      .then(refreshNotifications)
      .catch(() => setMarkError(true));
  }, [userId, refreshNotifications]);

  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        paddingHorizontal: 16,
        paddingVertical: 10,
        borderBottomWidth: 1,
        borderBottomColor: colors.border,
        backgroundColor: colors.background,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
        <Pressable accessibilityRole="button" accessibilityLabel="Open menu" onPress={onOpenDrawer} hitSlop={8}>
          <Ionicons name="menu-outline" size={22} color={colors.ink} />
        </Pressable>
        <Text style={{ fontWeight: "700", fontSize: 16, color: colors.navy }}>
          TarragonHealth
        </Text>
      </View>

      <View style={{ flexDirection: "row", alignItems: "center", gap: 16 }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Notifications"
          onPress={() => setNotifOpen(true)}
          // 20pt icon + 12pt slop each side reaches the ~44pt touch minimum.
          hitSlop={12}
          style={{ position: "relative" }}
        >
          <Ionicons name="notifications-outline" size={20} color={inkAlpha(0.6)} />
          {hasUnread ? (
            <View
              style={{
                position: "absolute",
                top: -6,
                right: -8,
                minWidth: 16,
                height: 16,
                borderRadius: 8,
                paddingHorizontal: 3,
                backgroundColor: colors.danger,
                borderWidth: 1.5,
                borderColor: colors.background,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Text style={{ fontSize: 9.5, fontWeight: "700", color: "#fff" }}>
                {notifications.filter((n) => n.status !== "read").length > 9
                  ? "9+"
                  : notifications.filter((n) => n.status !== "read").length}
              </Text>
            </View>
          ) : null}
        </Pressable>
        {/* 28pt avatar + 8pt slop each side reaches the ~44pt touch minimum. */}
        <Pressable accessibilityRole="button" accessibilityLabel="Profile" onPress={() => setProfileOpen(true)} hitSlop={8}>
          <View
            style={{
              width: 28,
              height: 28,
              borderRadius: 14,
              backgroundColor: colors.brandTint,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Text style={{ fontSize: 12, fontWeight: "700", color: colors.brandPressed }}>{initials}</Text>
          </View>
        </Pressable>
      </View>

      <DropdownModal visible={notifOpen} onClose={() => setNotifOpen(false)}>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 14, borderBottomWidth: 1, borderBottomColor: colors.border }}>
          <Text style={{ fontSize: 13.5, fontWeight: "600", color: colors.ink }}>Notifications</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Mark all notifications read"
            hitSlop={10}
            onPress={handleMarkAllRead}
          >
            <Text style={{ fontSize: 11.5, fontWeight: "600", color: colors.brand }}>Mark all read</Text>
          </Pressable>
        </View>
        {markError ? (
          <Text style={{ paddingHorizontal: 14, paddingTop: 8, fontSize: 11.5, color: colors.danger }}>
            Couldn&apos;t update those just now. Try again.
          </Text>
        ) : null}
        <ScrollView style={{ maxHeight: 320 }}>
          {loadingNotifs ? (
            <ActivityIndicator color={colors.brand} style={{ margin: 20 }} />
          ) : notifError ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="We couldn't load your notifications. Tap to retry."
              onPress={refreshNotifications}
              style={{ padding: 16, gap: 4 }}
            >
              <Text style={{ fontSize: 12.5, color: colors.ink, fontWeight: "600" }}>
                We couldn&apos;t load your notifications right now.
              </Text>
              <Text style={{ fontSize: 12, color: colors.brand, fontWeight: "600" }}>Tap to retry</Text>
            </Pressable>
          ) : notifications.length === 0 ? (
            <Text style={{ padding: 16, fontSize: 12.5, color: colors.muted }}>You&apos;re all caught up.</Text>
          ) : (
            notifications.map((n) => (
              <View
                key={n.id}
                style={{
                  padding: 12,
                  borderBottomWidth: 1,
                  borderBottomColor: colors.border,
                  backgroundColor: n.status !== "read" ? "rgba(14,124,82,0.04)" : "transparent",
                }}
              >
                <Text style={{ fontSize: 12.5, color: colors.ink }}>{describeNotification(n)}</Text>
                <Text style={{ fontSize: 10.5, color: colors.faint, marginTop: 2 }}>{relativeTime(n.createdAt)}</Text>
              </View>
            ))
          )}
        </ScrollView>
      </DropdownModal>

      <DropdownModal visible={profileOpen} onClose={() => setProfileOpen(false)}>
        <View style={{ padding: 12, gap: 4 }}>
          <Text style={{ fontSize: 13, fontWeight: "600", color: colors.ink }}>{patientName}</Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              setProfileOpen(false);
              onOpenSettings();
            }}
            style={{ borderTopWidth: 1, borderTopColor: colors.border, paddingVertical: 8, marginTop: 6 }}
          >
            <Text style={{ fontSize: 12.5, color: colors.ink }}>Profile &amp; settings</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              setProfileOpen(false);
              onSignOut();
            }}
            style={{
              borderWidth: 1,
              borderColor: colors.border,
              borderRadius: 8,
              padding: 8,
              alignItems: "center",
              marginTop: 4,
            }}
          >
            <Text style={{ fontSize: 12, fontWeight: "500", color: colors.ink }}>Sign out</Text>
          </Pressable>
        </View>
      </DropdownModal>
    </View>
  );
}

/** Top-right anchored dropdown panel, backed by a full-screen tap-to-close
 * scrim — same behaviour as the drawer, sized for a small menu instead. */
function DropdownModal({
  visible,
  onClose,
  children,
}: {
  visible: boolean;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onClose}>
      <Pressable accessibilityRole="button" onPress={onClose} style={{ flex: 1 }}>
        <View
          style={{
            position: "absolute",
            top: 56,
            right: 12,
            width: 280,
            maxWidth: "85%",
            backgroundColor: colors.card,
            borderRadius: 12,
            shadowColor: "#000",
            shadowOffset: { width: 0, height: 8 },
            shadowOpacity: 0.18,
            shadowRadius: 30,
            overflow: "hidden",
          }}
        >
          <Pressable onPress={(e) => e.stopPropagation()}>{children}</Pressable>
        </View>
      </Pressable>
    </Modal>
  );
}
