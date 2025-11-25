const fetch = require("node-fetch");

module.exports = async function standingsFull(req, res) {
  const season = req.query.season || 2025;
  const leagueId = 169608;

  const url = `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${season}/segments/0/leagues/${leagueId}?view=mStandings`;

  try {
    const raw = await fetch(url);
    const json = await raw.json();

    const teamsById = {};
    json.teams.forEach(t => {
      const name =
        t.name ||
        `${t.location || ""} ${t.nickname || ""}`.trim() ||
        t.abbrev ||
        `Team ${t.id}`;
      teamsById[t.id] = {
        name,
        abbrev: t.abbrev,
        rank: t.currentSimulationResults?.rank || null,
        playoffPct: t.currentSimulationResults?.playoffPct || null,
        divisionWinPct: t.currentSimulationResults?.divisionWinPct || null
      };
    });

    const rows = json.teams.map(t => {
      const meta = teamsById[t.id];
      const rec = t.currentSimulationResults?.modeRecord || {};

      return {
        teamId: t.id,
        teamName: meta.name,
        abbrev: meta.abbrev,
        rank: meta.rank,
        playoffPct: meta.playoffPct,
        divisionWinPct: meta.divisionWinPct,
        wins: rec.wins,
        losses: rec.losses,
        ties: rec.ties,
        streakType: rec.streakType,
        streakLength: rec.streakLength
      };
    });

    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
