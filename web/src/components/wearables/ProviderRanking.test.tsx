import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { ProviderRanking } from "@/components/wearables/ProviderRanking";

function Harness({ initial }: { initial: string[] }) {
  const [value, setValue] = useState(initial);
  return (
    <>
      <ProviderRanking value={value} onChange={setValue} badges={(p) => (p === "oura" ? "has data" : null)} />
      <output data-testid="value">{value.join(",")}</output>
    </>
  );
}

describe("provider ranking", () => {
  it("reorders, removes and adds providers, with names and notes", async () => {
    const user = userEvent.setup();
    render(<Harness initial={["garmin", "oura"]} />);
    const list = screen.getByRole("list", { name: "Provider ranking" });
    expect(within(list).getAllByRole("listitem").map((li) => li.textContent)).toEqual(["1Garmin", "2Ourahas data"]);
    await user.click(screen.getByRole("button", { name: "Move Oura up" }));
    expect(screen.getByTestId("value")).toHaveTextContent("oura,garmin");
    expect(screen.getByRole("button", { name: "Move Oura up" })).toBeDisabled();
    await user.selectOptions(screen.getByRole("combobox", { name: "Provider to add" }), "whoop");
    await user.click(screen.getByRole("button", { name: /Add/ }));
    expect(screen.getByTestId("value")).toHaveTextContent("oura,garmin,whoop");
    // providers already ranked are not offered again
    expect(within(screen.getByRole("combobox", { name: "Provider to add" })).queryByRole("option", { name: "Oura" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Remove Garmin" }));
    expect(screen.getByTestId("value")).toHaveTextContent("oura,whoop");
  });
});
