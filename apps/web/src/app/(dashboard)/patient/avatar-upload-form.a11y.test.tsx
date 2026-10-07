/** @jest-environment jsdom */
/**
 * Accessibility regression coverage for AvatarUploadForm — the profile
 * photo control on /patient/profile. Covers the default state and the
 * post-upload success state (the save-confirmation text is the interesting
 * one: it's rendered as a plain, unannounced <p>, see the fix applied to
 * this file alongside this test).
 */
import { useRouter } from "next/navigation";
import { fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { axe } from "jest-axe";
import { expectNoA11yViolations } from "@/test/a11y";
import { AvatarUploadForm } from "./avatar-upload-form";

// AvatarUploadForm calls useMutation directly (unlike most components here,
// which go through an already-mocked lib/queries hook), so it needs a real
// QueryClientProvider in the tree — same convention as lib/queries/consent.test.tsx.
function withQueryClient(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{ui}</QueryClientProvider>;
}

jest.mock("next/navigation", () => ({
  useRouter: jest.fn(),
}));
(useRouter as jest.Mock).mockReturnValue({ refresh: jest.fn() });

jest.mock("./actions", () => ({
  uploadPatientAvatar: jest.fn(async () => ({ error: null })),
}));

// jsdom doesn't implement the Blob URL APIs the preview thumbnail uses.
URL.createObjectURL = jest.fn(() => "blob:mock-preview");
URL.revokeObjectURL = jest.fn();

describe("AvatarUploadForm accessibility", () => {
  it("has no axe violations with no photo set", async () => {
    await expectNoA11yViolations(withQueryClient(<AvatarUploadForm fullName="Ada Okafor" avatarUrl={null} />));
  });

  it("has no axe violations with an existing photo", async () => {
    await expectNoA11yViolations(
      withQueryClient(
        <AvatarUploadForm fullName="Ada Okafor" avatarUrl="https://example.com/ada.jpg" />
      )
    );
  });

  it("has no axe violations, and announces the result, once a save completes", async () => {
    const { getByLabelText, findByText, container } = await expectNoA11yViolations(
      withQueryClient(<AvatarUploadForm fullName="Ada Okafor" avatarUrl={null} />)
    );
    const file = new File(["x"], "photo.jpg", { type: "image/jpeg" });
    fireEvent.change(getByLabelText("Upload a new photo"), { target: { files: [file] } });
    fireEvent.click(await findByText("Save photo"));

    const success = await findByText("Photo updated.");
    // A save confirmation that appears after the fact must be announced to a
    // screen-reader user, not just sighted ones — role="status" is an
    // assertive-free (polite) live region, matching FormSuccess's own
    // convention elsewhere on the platform (components/ui/form-error.tsx).
    expect(success.closest('[role="status"]')).not.toBeNull();

    expect(await axe(container)).toHaveNoViolations();
  });
});
