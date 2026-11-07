/** @jest-environment jsdom */
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { expectNoA11yViolations } from "@/test/a11y";
import { DataTable, type DataTableColumn, type DataTableRow } from "./data-table";

const columns: DataTableColumn[] = [
  { header: "Name", sortable: true },
  { header: "Paid", sortable: true, defaultDir: "desc", align: "right" },
  { header: "Note" },
];
const rows: DataTableRow[] = [
  { key: "a", cells: ["Ade", "₦300", "x"], sort: ["Ade", 300, null], searchText: "Ade Lagos" },
  { key: "b", cells: ["Bola", "₦20", "y"], sort: ["Bola", 20, null], searchText: "Bola Abuja" },
  { key: "c", cells: ["Chi", "₦100", "z"], sort: ["Chi", 100, null], searchText: "Chi Lagos" },
];
const firstColumn = () => within(screen.getByRole("table")).getAllByRole("row").slice(1).map((r) => within(r).getAllByRole("cell")[0].textContent);

describe("DataTable", () => {
  it("is accessible, with a caption and sortable headers as buttons", async () => {
    await expectNoA11yViolations(<DataTable caption="Patients" columns={columns} rows={rows} searchLabel="Search patients" />);
    expect(screen.getByRole("table", { name: "Patients" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Paid/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Note/ })).toBeNull();
  });

  it("sorts on its default direction first, flips on a second press, and says so with aria-sort", () => {
    render(<DataTable caption="Patients" columns={columns} rows={rows} />);
    fireEvent.click(screen.getByRole("button", { name: /Paid/ }));
    expect(firstColumn()).toEqual(["Ade", "Chi", "Bola"]);
    expect(screen.getByRole("columnheader", { name: /Paid/ }).getAttribute("aria-sort")).toBe("descending");
    fireEvent.click(screen.getByRole("button", { name: /Paid/ }));
    expect(firstColumn()).toEqual(["Bola", "Chi", "Ade"]);
  });

  it("searches, counts what matches, and says when nothing does", () => {
    render(<DataTable caption="Patients" columns={columns} rows={rows} searchLabel="Search patients" noun={{ one: "patient", many: "patients" }} />);
    fireEvent.change(screen.getByLabelText("Search patients"), { target: { value: "lagos" } });
    expect(firstColumn()).toEqual(["Ade", "Chi"]);
    expect(screen.getByText("2 patients match your search.")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Search patients"), { target: { value: "kano" } });
    expect(screen.getByText('Nothing matches "kano".')).toBeTruthy();
  });

  it("pages client-side", () => {
    render(<DataTable caption="Patients" columns={columns} rows={rows} pageSize={2} />);
    expect(firstColumn()).toEqual(["Ade", "Bola"]);
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(firstColumn()).toEqual(["Chi"]);
    expect(screen.getByText("3 rows. Page 2 of 2.")).toBeTruthy();
  });

  it("shows the empty message and a load error as an alert", () => {
    render(<DataTable caption="Patients" columns={columns} rows={[]} emptyMessage="No patients yet." error="That did not load." />);
    expect(screen.getByText("No patients yet.")).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toBe("That did not load.");
  });

  it("in server mode hands sort and page to the caller and shows its rows as given", () => {
    const onSort = jest.fn();
    const onPage = jest.fn();
    render(
      <DataTable
        caption="Patients"
        columns={columns}
        rows={rows}
        server={{ sort: { column: 0, dir: "asc" }, onSort, page: 0, pageCount: 4, matching: 90, onPage }}
      />
    );
    expect(firstColumn()).toEqual(["Ade", "Bola", "Chi"]);
    fireEvent.click(screen.getByRole("button", { name: /Name/ }));
    expect(onSort).toHaveBeenCalledWith({ column: 0, dir: "desc" });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(onPage).toHaveBeenCalledWith(1);
    expect(screen.getByText("90 rows. Page 1 of 4.")).toBeTruthy();
  });

  it("keeps a row's own state through a search and a page change (a typed note, a key shown once)", () => {
    function Note({ id }: { id: string }) {
      const [text, setText] = useState("");
      return <input aria-label={`Note for ${id}`} value={text} onChange={(e) => setText(e.target.value)} />;
    }
    const withState: DataTableRow[] = rows.map((r) => ({ ...r, cells: [...r.cells.slice(0, 2), <Note key="n" id={r.key} />] }));
    render(<DataTable caption="Patients" columns={columns} rows={withState} searchLabel="Search patients" pageSize={2} />);
    fireEvent.change(screen.getByLabelText("Note for a"), { target: { value: "half typed" } });
    fireEvent.change(screen.getByLabelText("Search patients"), { target: { value: "abuja" } });
    expect(firstColumn()).toEqual(["Bola"]);
    fireEvent.change(screen.getByLabelText("Search patients"), { target: { value: "" } });
    expect((screen.getByLabelText("Note for a") as HTMLInputElement).value).toBe("half typed");
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.click(screen.getByRole("button", { name: "Previous" }));
    expect((screen.getByLabelText("Note for a") as HTMLInputElement).value).toBe("half typed");
  });

  it("announces the count only once typing pauses", () => {
    jest.useFakeTimers();
    render(<DataTable caption="Patients" columns={columns} rows={rows} searchLabel="Search patients" />);
    act(() => jest.advanceTimersByTime(800));
    const live = document.querySelector("[aria-live=polite]") as HTMLElement;
    expect(live.textContent).toBe("3 rows.");
    fireEvent.change(screen.getByLabelText("Search patients"), { target: { value: "l" } });
    fireEvent.change(screen.getByLabelText("Search patients"), { target: { value: "lagos" } });
    expect(live.textContent).toBe("3 rows.");
    act(() => jest.advanceTimersByTime(800));
    expect(live.textContent).toBe("2 rows match your search.");
    jest.useRealTimers();
  });
});
