import request from "supertest";
import app from "../src/index.js";
import { describe, it, expect } from "vitest";

describe("health and auth", () => {
  it("GET /health", async () => {
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it("POST /auth/login missing fields -> 400", async () => {
    const res = await request(app).post("/auth/login").send({});
    expect(res.status).toBe(400);
  });
});

