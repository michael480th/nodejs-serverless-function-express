const { fetchESPNData, fetchTeamMetadata } = require("../utils/fetch");
const {
  getTeamName,
  getNFLTeamName,
  getNFLTeamAbbrev,
  getPositionName
} = require("../utils/mappings");

module.exports = async (req, res) => {
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    return res.status(200).end();
  }

  try {
    const season = parseInt(req.query.season, 10) || new Date().getFullYear();

    // Fetch team metadata for mapping onTeamId -> readable name/abbrev
    const teamMeta = await fetchTeamMetadata(season);
    const members = teamMeta.members || [];
    const teamMap = {};
    (teamMeta.teams || []).forEach(team => {
      teamMap[team.id] = {
        name: getTeamName(team, members),
        abbrev: team.abbrev || ""
      };
    });

    // Fetch full player catalog (kona player info)
    const konaResponse = await fetchESPNData(season, "kona_player_info");
    const players = konaResponse.players || [];

    const rows = players.map(entry => {
      const player = entry.player || {};
      const onTeamId = entry.onTeamId || null;
      const fantasyTeam = teamMap[onTeamId] || { name: null, abbrev: null };
      const rosterStatus = onTeamId ? "ROSTERED" : "FREE_AGENT";

      return {
        season,
        playerId: player.id,
        fullName: player.fullName,
        firstName: player.firstName,
        lastName: player.lastName,
        positionId: player.defaultPositionId || null,
        position: getPositionName(player.defaultPositionId),
        proTeamId: player.proTeamId || null,
        proTeamName: getNFLTeamName(player.proTeamId),
        proTeamAbbrev: getNFLTeamAbbrev(player.proTeamId),
        injuryStatus: player.injuryStatus || player.status || "ACTIVE",
        active: player.active,
        rosterStatus,
        onTeamId,
        onTeamName: fantasyTeam.name,
        onTeamAbbrev: fantasyTeam.abbrev
      };
    });

    // Sort free agents first, then by player name for easier scanning
    rows.sort((a, b) => {
      if (a.rosterStatus === b.rosterStatus) {
        return (a.fullName || "").localeCompare(b.fullName || "");
      }
      return a.rosterStatus === "FREE_AGENT" ? -1 : 1;
    });

    res.setHeader("Content-Type", "application/json");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.status(200).json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};


