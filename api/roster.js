export default async function handler(req, res) {
  const { season = 2025 } = req.query;

  const rosterUrl = `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${season}/segments/0/leagues/169608?view=mRoster`;
  const teamUrl   = `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${season}/segments/0/leagues/169608?view=mTeam`;

  try {
    // Fetch both endpoints in parallel
    const [rosterRes, teamRes] = await Promise.all([
      fetch(rosterUrl),
      fetch(teamUrl)
    ]);

    const rosterData = await rosterRes.json();
    const teamData = await teamRes.json();

    // Build member lookup (owner names)
    const memberNames = {};
    for (const m of teamData.members) {
      memberNames[m.id] = m.displayName;
    }

    // Build team lookup (teamId → team info)
    const teamLookup = {};
    for (const t of teamData.teams) {

      const ownerId = t.owners?.[0];
      const ownerName = memberNames[ownerId] || "Unknown Owner";

      const resolvedTeamName =
        t.name ||
        `${t.location || ""} ${t.nickname || ""}`.trim() ||
        ownerName;

      teamLookup[t.id] = {
        id: t.id,
        name: resolvedTeamName,
        abbrev: t.abbrev,
        owner: ownerName
      };
    }

    // Now build the final roster dataset
    const teams = rosterData.teams.map(rt => {
      const meta = teamLookup[rt.id];

      return {
        id: rt.id,
        name: meta.name,
        abbrev: meta.abbrev,
        owner: meta.owner,

        roster: rt.roster.entries.map(e => ({
          playerId: e.playerId,
          fullName: e.playerPoolEntry.player.fullName,
          defaultPositionId: e.playerPoolEntry.player.defaultPositionId,
          proTeamId: e.playerPoolEntry.player.proTeamId,
          lineupSlotId: e.lineupSlotId
        }))
      };
    });

    return res.status(200).json({ season, leagueId: 169608, teams });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
