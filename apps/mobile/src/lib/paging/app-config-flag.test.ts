/** S19e: the iPhone Critical Alerts switch in app.config.js stays off unless the build sets the explicit entitlement flag. */
describe("app.config.js critical-alerts flag", () => {
  const load = () => {
    jest.resetModules();
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require("../../../app.config.js") as (a: { config: Record<string, unknown> }) => { extra?: { iosCriticalAlerts?: boolean } };
  };
  afterEach(() => {
    delete process.env.IOS_CRITICAL_ALERTS_ENTITLEMENT;
    delete process.env.IOS_TIME_SENSITIVE;
  });
  it("stays off by default and for the time-sensitive build", () => {
    const config = { name: "x", ios: {} };
    expect(load()({ config }).extra).toBeUndefined();
    process.env.IOS_TIME_SENSITIVE = "1";
    expect(load()({ config }).extra).toBeUndefined();
  });
  it("is switched on only by the explicit entitlement flag", () => {
    process.env.IOS_CRITICAL_ALERTS_ENTITLEMENT = "1";
    expect(load()({ config: { name: "x", ios: {}, extra: { eas: { projectId: "p" } } } }).extra).toEqual({ eas: { projectId: "p" }, iosCriticalAlerts: true });
  });
});
