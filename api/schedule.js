// schedule.js
// Returns a clean schedule table with team names resolved from ESPN.

export default async function handler(req, res) {
  try {
    const season = req.query.season || 2025;
    const leagueId = 169608;

    // Pull standings (contains schedule + teams)
    const url = `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${season}/segments/0/leagues/${leagueId}?view=mStandings`;
    const espnRes = await fetch(url);
    const data = await espnRes.json();

    // Build lookup: teamId -> { name, abbrev }
    const teamLookup = {};
    for (const t of data.teams || []) {
      teamLookup[t.id] = {
        name: t.location && t.nickname ? `${t.location} ${t.nickname}` : t.name || "",
        abbrev: t.abbrev || ""
      };
    }

    // Convert schedule to rows
    const rows = (data.schedule || []).map((m, idx) => {
      const a = m.away || {};
      const h = m.home || {};

      return {
        matchupIndex: idx + 1,
        matchupPeriodId: m.matchupPeriodId,

        awayTeamId: a.teamId,
        awayTeamName: teamLookup[a.teamId]?.name || "",
        awayAbbrev: teamLookup[a.teamId]?.abbrev || "",
        awayPoints: a.totalPoints,

        homeTeamId: h.teamId,
        homeTeamName: teamLookup[h.teamId]?.name || "",
        homeAbbrev: teamLookup[h.teamId]?.abbrev || "",
        homePoints: h.totalPoints
      };
    });

    res.status(200).json(rows);

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
