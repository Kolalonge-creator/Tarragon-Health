const mockResize = jest.fn();
const mockRelease = jest.fn();
const mockSaveAsync = jest.fn(async (...args: unknown[]) => ({ n: args.length, uri: "file:///out.jpg", width: 1, height: 1 }));
const mockRenderAsync = jest.fn(async () => ({ saveAsync: mockSaveAsync }));

jest.mock("expo-image-manipulator", () => ({
  SaveFormat: { JPEG: "jpeg" },
  ImageManipulator: {
    manipulate: jest.fn(() => ({ resize: mockResize, renderAsync: mockRenderAsync, release: mockRelease })),
  },
}));

import { PHOTO_JPEG_QUALITY, PHOTO_MAX_SIDE, resizeTarget, resizeToJpeg } from "./photo-resize";

beforeEach(() => jest.clearAllMocks());

describe("resizeTarget", () => {
  it("constrains the longest side to 1600", () => {
    expect(PHOTO_MAX_SIDE).toBe(1600);
    expect(resizeTarget(4000, 3000, 1600)).toEqual({ width: 1600 });
    expect(resizeTarget(3000, 4000, 1600)).toEqual({ height: 1600 });
  });
  it("never upscales and tolerates unknown dimensions", () => {
    expect(resizeTarget(800, 600, 1600)).toBeNull();
    expect(resizeTarget(null, null, 1600)).toBeNull();
  });
});

describe("resizeToJpeg", () => {
  it("requests a 1600 px resize and a JPEG at quality 0.7", async () => {
    const uri = await resizeToJpeg("file:///in.jpg", 4000, 3000);
    expect(mockResize).toHaveBeenCalledWith({ width: 1600 });
    expect(mockSaveAsync).toHaveBeenCalledWith({ format: "jpeg", compress: PHOTO_JPEG_QUALITY });
    expect(PHOTO_JPEG_QUALITY).toBe(0.7);
    expect(uri).toBe("file:///out.jpg");
    expect(mockRelease).toHaveBeenCalled();
  });
  it("re-encodes without resizing a small photo, and releases on failure", async () => {
    await resizeToJpeg("file:///in.jpg", 800, 600);
    expect(mockResize).not.toHaveBeenCalled();
    mockRenderAsync.mockRejectedValueOnce(new Error("boom"));
    await expect(resizeToJpeg("file:///in.jpg", 800, 600)).rejects.toThrow("boom");
    expect(mockRelease).toHaveBeenCalledTimes(2);
  });
});
