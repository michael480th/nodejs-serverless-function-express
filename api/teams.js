const fetch = require("node-fetch");

module.exports = async function teams(req, res) {
  const season = req.query.season || 2025;
  const leagueId = 169608;

  const url = `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${season}/segments/0/leagues/${leagueId}`;

  try {
    const raw = await fetch(url);
    const json = await raw.json();

    const rows = json.teams.map(t => {
      const name =
        t.name ||
        `${t.location || ""} ${t.nickname || ""}`.trim() ||
        t.abbrev ||
        `Team ${t.id}`;

      return {
        teamId: t.id,
        teamName: name,
        abbrev: t.abbrev,
        owner: t.owners?.[0] || null,
        playoffSeed: t.playoffSeed,
        pointsFor: t.points,
        pointsAgainst: t.record?.overall?.pointsAgainst || null,
        wins: t.record?.overall?.wins || null,
        losses: t.record?.overall?.losses || null,
        ties: t.record?.overall?.ties || null,
        pct: t.record?.overall?.percentage || null
      };
    });

    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
