import type { ReactNode } from "react";
import { Modal, View } from "react-native";
import { ForceLight, space, useTheme } from "../design";
import { Button } from "./Button";

interface LegacySheetProps {
  visible: boolean;
  onClose: () => void;
  closeLabel: string;
  children: ReactNode;
}

/**
 * A full-screen sheet for a screen that has not moved onto the kit yet (light-only).
 * Drawn entirely in the light scheme with a Close button, so the kit parts around the
 * old screen match it. Delete a use of this when the screen inside it moves.
 */
export function LegacySheet({ visible, onClose, closeLabel, children }: LegacySheetProps) {
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <ForceLight>
        <Body onClose={onClose} closeLabel={closeLabel}>
          {children}
        </Body>
      </ForceLight>
    </Modal>
  );
}

function Body({ onClose, closeLabel, children }: { onClose: () => void; closeLabel: string; children: ReactNode }) {
  const { colors } = useTheme();
  return (
    <View style={{ flex: 1, backgroundColor: colors.canvas }}>
      <View style={{ padding: space.xl, paddingTop: 56 }}>
        <Button title={closeLabel} variant="secondary" onPress={onClose} />
      </View>
      {children}
    </View>
  );
}
