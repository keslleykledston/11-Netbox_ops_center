import request from "supertest";
import app from "../src/index.js";
import { describe, it, expect } from "vitest";

describe("devices security", () => {
  it("GET /devices without token -> 401", async () => {
    const res = await request(app).get("/devices");
    expect(res.status).toBe(401);
  });
});

