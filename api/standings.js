const fetch = require("node-fetch");

module.exports = async function standings(req, res) {
  const season = req.query.season || 2025;
  const leagueId = 169608;

  const url = `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${season}/segments/0/leagues/${leagueId}?view=mTeam`;

  try {
    const raw = await fetch(url);
    const json = await raw.json();

    const rows = json.teams.map(t => {
      const name =
        t.name ||
        `${t.location || ""} ${t.nickname || ""}`.trim() ||
        t.abbrev ||
        `Team ${t.id}`;

      const r = t.record?.overall || {};

      return {
        teamId: t.id,
        teamName: name,
        abbrev: t.abbrev,
        wins: r.wins,
        losses: r.losses,
        ties: r.ties,
        pct: r.percentage,
        pointsFor: r.pointsFor,
        pointsAgainst: r.pointsAgainst
      };
    });

    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
