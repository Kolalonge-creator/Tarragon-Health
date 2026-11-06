/** P12 (spec 8.1): test requests grouped by where they stand, in the order the patient has to act on them. */
import { Constants } from "@tarragon/shared";
import { LAB_ORDER_GROUPS, LAB_ORDER_GROUP_OF, groupLabOrders } from "./order-groups";

describe("groupLabOrders", () => {
  it("has a group for every live order status", () => {
    expect(Object.keys(LAB_ORDER_GROUP_OF).sort()).toEqual([...Constants.public.Enums.lab_order_status].sort());
    const ids = new Set(LAB_ORDER_GROUPS.map((g) => g.id));
    for (const group of Object.values(LAB_ORDER_GROUP_OF)) expect(ids.has(group)).toBe(true);
  });

  it("orders groups by what needs doing, drops empty ones, and keeps newest-first inside a group", () => {
    const orders = [
      { id: "a", status: "resulted" as const },
      { id: "b", status: "ordered" as const },
      { id: "c", status: "sample_rejected" as const },
      { id: "d", status: "processing" as const },
    ];
    const groups = groupLabOrders(orders);
    expect(groups.map((g) => g.id)).toEqual(["new_sample", "waiting", "back"]);
    expect(groups[1]!.orders.map((o) => o.id)).toEqual(["b", "d"]);
  });

  it("never loses a request", () => {
    const orders = Constants.public.Enums.lab_order_status.map((status, i) => ({ id: String(i), status }));
    expect(groupLabOrders(orders).flatMap((g) => g.orders)).toHaveLength(orders.length);
  });
});
