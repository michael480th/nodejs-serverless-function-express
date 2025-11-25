import express from "express";
import teams from "./teams";
import schedule from "./schedule";
import standings from "./standings";
import standingsFull from "./standingsFull";
import roster from "./roster";

const app = express();

// Simple health check
app.get("/", (req, res) => {
  res.send("API is running");
});

// Fantasy routes
app.get("/api/teams", teams);
app.get("/api/schedule", schedule);
app.get("/api/standings", standings);
app.get("/api/standingsfull", standingsFull);
app.get("/api/roster", roster);

// Export for Vercel / serverless
export default app;
