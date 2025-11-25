export default async function standings(req, res) {
  const season = req.query.season || 2025;

  const url = `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${season}/segments/0/leagues/169608?view=mStandings`;

  try {
    const espnRes = await fetch(url);
    const data = await espnRes.json();

    const teams = data.teams.map(t => ({
      teamId: t.id,
      playoffClinchType: t.playoffClinchType,
      rank: t.currentSimulationResults?.rank,
      playoffPct: t.currentSimulationResults?.playoffPct,
      divisionWinPct: t.currentSimulationResults?.divisionWinPct
    }));

    res.status(200).json({
      season,
      leagueId: data.id,
      teams
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
