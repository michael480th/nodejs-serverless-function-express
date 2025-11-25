export default async function handler(req, res) {
  const { season = 2025 } = req.query;

  const rosterUrl = `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${season}/segments/0/leagues/169608?view=mRoster`;
  const teamUrl   = `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${season}/segments/0/leagues/169608?view=mTeam`;

  try {
    const [rosterRes, teamRes] = await Promise.all([
      fetch(rosterUrl),
      fetch(teamUrl)
    ]);

    const rosterData = await rosterRes.json();
    const teamData = await teamRes.json();

    // Position ID → Name
    const posMap = {
      1: "QB",
      2: "RB",
      3: "WR",
      4: "TE",
      5: "K",
      16: "DEF"
    };

    // NFL Team ID → Abbrev
    const nflTeams = {
      1: "ATL", 2: "BUF", 3: "CHI", 4: "CIN", 5: "CLE",
      6: "DAL", 7: "DEN", 8: "DET", 9: "GB", 10: "TEN",
      11: "IND", 12: "KC", 13: "LV", 14: "LAR", 15: "MIA",
      16: "MIN", 17: "NE", 18: "NO", 19: "NYG", 20: "NYJ",
      21: "PHI", 22: "ARI", 23: "PIT", 24: "LAC", 25: "SF",
      26: "SEA", 27: "TB", 28: "WAS", 29: "CAR", 30: "JAX",
      33: "BAL", 34: "HOU"
    };

    // Build lookup for owner display names
    const memberNames = {};
    for (const m of teamData.members) {
      memberNames[m.id] = m.displayName;
    }

    // Build lookup for team metadata
    const teamLookup = {};
    for (const t of teamData.teams) {
      const ownerId = t.owners?.[0];
      const ownerName = memberNames[ownerId] || "Unknown Owner";

      const resolvedName =
        t.name ||
        `${t.location || ""} ${t.nickname || ""}`.trim() ||
        ownerName;

      teamLookup[t.id] = {
        id: t.id,
        name: resolvedName,
        abbrev: t.abbrev,
        owner: ownerName
      };
    }

    // Helper: extract stat bucket
    function getStat(player, src, split) {
      if (!player.stats) return null;
      const found = player.stats.find(
        s => s.statSourceId === src && s.statSplitTypeId === split
      );
      return found ? found.appliedTotal : null;
    }

    const teams = rosterData.teams.map(rt => {
      const meta = teamLookup[rt.id];

      return {
        id: rt.id,
        name: meta.name,
        abbrev: meta.abbrev,
        owner: meta.owner,

        roster: rt.roster.entries.map(e => {
          const p = e.playerPoolEntry.player;
          return {
            playerId: p.id,
            fullName: p.fullName,

            position: posMap[p.defaultPositionId] || "UNK",
            proTeam: nflTeams[p.proTeamId] || "UNK",
            lineupSlotId: e.lineupSlotId,

            // Ranking (STANDARD)
            rank: p.ratingsByRankType?.STANDARD?.rank ?? null,

            // Four scoring buckets
            seasonPoints: getStat(p, 0, 0),          // actual season-to-date
            seasonProjectedPoints: getStat(p, 1, 0), // projected season total
            weekPoints: getStat(p, 0, 1),            // actual this week
            weekProjectedPoints: getStat(p, 1, 1)    // projected this week
          };
        })
      };
    });

    return res.status(200).json({ season, leagueId: 169608, teams });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
