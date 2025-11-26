const { fetchESPNData, fetchTeamMetadata } = require("../utils/fetch");
const { getTeamName } = require("../utils/mappings");

module.exports = async (req, res) => {
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    return res.status(200).end();
  }
  
  try {
    const years = parseInt(req.query.years) || 5;
    const currentYear = new Date().getFullYear();
    const allRows = [];
    
    // Fetch data for each season
    for (let i = 0; i < years; i++) {
      const season = currentYear - i;
      
      try {
        // Fetch team metadata for name resolution
        const teamData = await fetchTeamMetadata(season);
        const teamMap = {};
        (teamData.teams || []).forEach(team => {
          teamMap[team.id] = {
            name: getTeamName(team, teamData.members || []),
            abbrev: team.abbrev || ""
          };
        });
        
        // Fetch schedule data
        const scheduleData = await fetchESPNData(season, "mStandings");
        const schedule = scheduleData.schedule || [];
        
        // Process each matchup
        schedule.forEach((matchup, matchupIndex) => {
          const week = matchup.matchupPeriodId || 0;
          const awayTeamId = matchup.away?.teamId || 0;
          const homeTeamId = matchup.home?.teamId || 0;
          const awayPoints = matchup.away?.totalPoints || 0;
          const homePoints = matchup.home?.totalPoints || 0;
          
          const awayTeam = teamMap[awayTeamId] || { name: `Team ${awayTeamId}`, abbrev: "" };
          const homeTeam = teamMap[homeTeamId] || { name: `Team ${homeTeamId}`, abbrev: "" };
          
          // Create row for away team
          allRows.push({
            season: season,
            week: week,
            matchupId: matchupIndex + 1,
            teamId: awayTeamId,
            teamName: awayTeam.name,
            teamAbbrev: awayTeam.abbrev,
            location: "away",
            opponentTeamId: homeTeamId,
            opponentTeamName: homeTeam.name,
            opponentTeamAbbrev: homeTeam.abbrev,
            pointsFor: awayPoints,
            pointsAgainst: homePoints,
            opponentPoints: homePoints,
            pointDiff: awayPoints - homePoints
          });
          
          // Create row for home team
          allRows.push({
            season: season,
            week: week,
            matchupId: matchupIndex + 1,
            teamId: homeTeamId,
            teamName: homeTeam.name,
            teamAbbrev: homeTeam.abbrev,
            location: "home",
            opponentTeamId: awayTeamId,
            opponentTeamName: awayTeam.name,
            opponentTeamAbbrev: awayTeam.abbrev,
            pointsFor: homePoints,
            pointsAgainst: awayPoints,
            opponentPoints: awayPoints,
            pointDiff: homePoints - awayPoints
          });
        });
      } catch (error) {
        // Skip this season if fetch fails, continue to next season
        console.error(`Error fetching season ${season}:`, error.message);
        continue;
      }
    }
    
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.status(200).json(allRows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

