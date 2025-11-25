export default async function standingsFull(req, res) {
  const season = req.query.season || 2025;

  const url = `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${season}/segments/0/leagues/169608?view=mStandings`;

  try {
    const espnRes = await fetch(url);
    const data = await espnRes.json();

    // Full simulation breakdown
    const teams = data.teams.map(t => ({
      teamId: t.id,
      playoffClinchType: t.playoffClinchType,
      rank: t.currentSimulationResults?.rank,
      playoffPct: t.currentSimulationResults?.playoffPct,
      divisionWinPct: t.currentSimulationResults?.divisionWinPct,
      modeRecord: t.currentSimulationResults?.modeRecord || {}
    }));

    // Full schedule matrix
    const schedule = data.schedule.map(m => ({
      week: m.matchupPeriodId,
      homeTeamId: m.home.teamId,
      homePoints: m.home.totalPoints,
      awayTeamId: m.away.teamId,
      awayPoints: m.away.totalPoints
    }));

    // League status block
    const status = {
      currentMatchupPeriod: data.status?.currentMatchupPeriod,
      latestScoringPeriod: data.status?.latestScoringPeriod,
      firstScoringPeriod: data.status?.firstScoringPeriod,
      finalScoringPeriod: data.status?.finalScoringPeriod,
      isActive: data.status?.isActive,
      isFull: data.status?.isFull,
      previousSeasons: data.status?.previousSeasons || [],
      waiverLastExecutionDate: data.status?.waiverLastExecutionDate,
      waiverProcessStatus: data.status?.waiverProcessStatus || {}
    };

    res.status(200).json({
      season,
      leagueId: data.id,
      schedule,
      teams,
      status
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
