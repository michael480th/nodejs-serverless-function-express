export default async function roster(req, res) {
  const season = req.query.season || 2025;

  const url = `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${season}/segments/0/leagues/169608?view=mRoster`;

  try {
    const espnRes = await fetch(url);
    const data = await espnRes.json();

    const teams = data.teams.map(team => ({
      teamId: team.id,
      name: team.name || `${team.location} ${team.nickname}`.trim(),
      abbrev: team.abbrev,
      roster: team.roster.entries.map(e => ({
        playerId: e.playerId,
        fullName: e.playerPoolEntry.player.fullName,
        positionId: e.playerPoolEntry.player.defaultPositionId,
        proTeamId: e.playerPoolEntry.player.proTeamId,
        lineupSlotId: e.lineupSlotId
      }))
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
