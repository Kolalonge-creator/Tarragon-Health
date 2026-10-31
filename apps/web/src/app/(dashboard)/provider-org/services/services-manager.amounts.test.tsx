/** @jest-environment jsdom */
/**
 * A service price that could not be read used to be saved as no price at all, and the form was cleared.
 * Now an unreadable price is refused with the reason and what was typed stays in the form.
 *
 * The box is a number input, which already stops commas, spaces and letters. What it allows is scientific notation and
 * extra decimals, so those are tested.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

jest.mock("next/navigation", () => ({ useRouter: () => ({ refresh: jest.fn() }) }));
const create = jest.fn(async () => ({ message: "Added" }));
jest.mock("./actions", () => ({
  createServiceAction: (...a: unknown[]) => (create as (...x: unknown[]) => unknown)(...a),
  deactivateServiceAction: jest.fn(),
}));

import { ServicesManager } from "./services-manager";

beforeEach(() => create.mockClear());

function submit(name: string, price: string) {
  render(<ServicesManager organisationId="o1" services={[]} />);
  fireEvent.change(screen.getByLabelText("Name"), { target: { value: name } });
  fireEvent.change(screen.getByLabelText("Price (₦)"), { target: { value: price } });
  fireEvent.submit(screen.getByLabelText("Name").closest("form") as HTMLFormElement);
}
const sentForm = () => (create.mock.calls[0] as unknown as [unknown, FormData])[1];

describe("service price", () => {
  it("sends the exact whole kobo", async () => {
    submit("Cardiology consultation", "12500.50");
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    expect(sentForm().get("priceKobo")).toBe("1250050");
    expect(sentForm().get("priceNaira")).toBeNull();
  });

  it("sends no price when the box is blank, which means no price", async () => {
    submit("Cardiology consultation", "");
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    expect(sentForm().get("priceKobo")).toBeNull();
  });

  it.each(["1e3", "12.345"])("refuses a price of %s, saves nothing and keeps what was typed", (price) => {
    submit("Cardiology consultation", price);
    expect(screen.getByText(/^Price: /)).toBeTruthy();
    expect(create).not.toHaveBeenCalled();
    expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe("Cardiology consultation");
  });
});
