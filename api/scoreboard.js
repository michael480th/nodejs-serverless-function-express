const { fetchESPNData, fetchTeamMetadata } = require("../utils/fetch");
const { getTeamName } = require("../utils/mappings");

// Starting lineup slot IDs (exclude bench, IR, etc.)
const STARTING_SLOTS = [0, 2, 4, 6, 16, 17, 23, 24]; // QB, RB, WR, TE, K, DEF, FLEX, OP

/**
 * Calculate projected total from roster entries for a specific week
 * Uses currentScore as base and adds projected totals for players yet to play
 * in starting lineup positions
 */
function calculateProjectedTotal(rosterEntries, weekNum, currentScore) {
  const startingPlayers = rosterEntries.filter(e => STARTING_SLOTS.includes(e.lineupSlotId));
  
  // Start with current score (already includes points from players who have played)
  let projected = currentScore;
  
  startingPlayers.forEach(entry => {
    const player = entry.playerPoolEntry?.player;
    if (!player) return;
    
    // Look for stats for this week
    const stats = player.stats || [];
    const actualStats = stats.find(s => s.scoringPeriodId === weekNum && s.statSourceId === 0);
    const projectedStats = stats.find(s => s.scoringPeriodId === weekNum && s.statSourceId === 1);
    
    // If player hasn't played yet (no actual stats), add their projected points
    if (!actualStats && projectedStats) {
      const playerProjected = projectedStats.projectedTotal || projectedStats.appliedTotal || 0;
      projected += playerProjected;
    }
    // If player is currently playing or has partial stats, use projected if higher
    else if (actualStats && projectedStats) {
      const actualPoints = actualStats.appliedTotal || 0;
      const projectedPoints = projectedStats.projectedTotal || 0;
      // Add the difference if projection is higher (for players still playing)
      if (projectedPoints > actualPoints) {
        projected += (projectedPoints - actualPoints);
      }
    }
  });
  
  return projected;
}

module.exports = async (req, res) => {
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    return res.status(200).end();
  }
  
  try {
    const season = req.query.season || new Date().getFullYear();
    const week = req.query.week || null; // Optional: filter by specific week
    
    // Fetch team metadata for name resolution
    const teamData = await fetchTeamMetadata(season);
    const teamMap = {};
    (teamData.teams || []).forEach(team => {
      const record = team.record?.overall || {};
      const divisionRecord = team.record?.division || {};
      
      teamMap[team.id] = {
        name: getTeamName(team, teamData.members || []),
        abbrev: team.abbrev || "",
        record: {
          wins: record.wins || 0,
          losses: record.losses || 0,
          ties: record.ties || 0,
          divisionRank: divisionRecord.rank || team.rankCalculatedFinal || 0
        }
      };
    });
    
    // Fetch matchup score data
    const matchupData = await fetchESPNData(season, "mMatchupScore");
    const schedule = matchupData.schedule || [];
    
    // Determine if we need roster data for projections
    // Check if any matchups might be incomplete (need to check if projected totals are missing)
    let rosterData = null;
    const needsRosterCheck = schedule.some(m => {
      const awayProjected = m.away?.totalProjectedPointsLive || m.away?.totalProjectedPoints;
      const homeProjected = m.home?.totalProjectedPointsLive || m.home?.totalProjectedPoints;
      return !awayProjected || !homeProjected;
    });
    
    if (needsRosterCheck) {
      try {
        rosterData = await fetchESPNData(season, "mRoster");
      } catch (error) {
        console.warn("Could not fetch roster data for projections:", error.message);
      }
    }
    
    // Process matchups
    const matchups = schedule
      .filter(m => !week || m.matchupPeriodId === parseInt(week))
      .map((matchup, index) => {
        const weekNum = matchup.matchupPeriodId || 0;
        const awayTeamId = matchup.away?.teamId || 0;
        const homeTeamId = matchup.home?.teamId || 0;
        
        const awayTeam = teamMap[awayTeamId] || { name: `Team ${awayTeamId}`, abbrev: "", record: { wins: 0, losses: 0, ties: 0, divisionRank: 0 } };
        const homeTeam = teamMap[homeTeamId] || { name: `Team ${homeTeamId}`, abbrev: "", record: { wins: 0, losses: 0, ties: 0, divisionRank: 0 } };
        
        // Get current scores
        const awayScore = matchup.away?.totalPoints || 0;
        const homeScore = matchup.home?.totalPoints || 0;
        
        // Get projected totals from matchup data if available
        let awayProjected = matchup.away?.totalProjectedPointsLive || matchup.away?.totalProjectedPoints;
        let homeProjected = matchup.home?.totalProjectedPointsLive || matchup.home?.totalProjectedPoints;
        
        // If projections are missing, try to calculate from roster
        if ((!awayProjected || !homeProjected) && rosterData) {
          const awayRoster = rosterData.teams?.find(t => t.id === awayTeamId)?.roster?.entries || [];
          const homeRoster = rosterData.teams?.find(t => t.id === homeTeamId)?.roster?.entries || [];
          
          if (!awayProjected) {
            awayProjected = calculateProjectedTotal(awayRoster, weekNum, awayScore);
          }
          
          if (!homeProjected) {
            homeProjected = calculateProjectedTotal(homeRoster, weekNum, homeScore);
          }
        }
        
        // Fallback to current score if still no projection
        awayProjected = awayProjected || awayScore;
        homeProjected = homeProjected || homeScore;
        
        // Get player status counts (currently playing, yet to play, minutes left)
        // These fields may have different names in the API, so we'll try multiple possibilities
        const awayCurrentlyPlaying = matchup.away?.playersCurrentlyPlaying || 
                                     matchup.away?.playerIdsCurrentlyPlaying?.length || 0;
        const homeCurrentlyPlaying = matchup.home?.playersCurrentlyPlaying || 
                                     matchup.home?.playerIdsCurrentlyPlaying?.length || 0;
        const awayYetToPlay = matchup.away?.playersYetToPlay || 
                              matchup.away?.playerIdsYetToPlay?.length || 0;
        const homeYetToPlay = matchup.home?.playersYetToPlay || 
                              matchup.home?.playerIdsYetToPlay?.length || 0;
        const awayMinsLeft = matchup.away?.minutesRemaining || 0;
        const homeMinsLeft = matchup.home?.minutesRemaining || 0;
        
        return {
          week: weekNum,
          matchupIndex: index + 1,
          awayTeam: {
            teamId: awayTeamId,
            teamName: awayTeam.name,
            teamAbbrev: awayTeam.abbrev,
            record: `${awayTeam.record.wins}-${awayTeam.record.losses}-${awayTeam.record.ties}`,
            divisionRank: awayTeam.record.divisionRank,
            score: Math.round(awayScore * 10) / 10,
            projectedTotal: Math.round(awayProjected * 10) / 10,
            currentlyPlaying: awayCurrentlyPlaying,
            yetToPlay: awayYetToPlay,
            minutesLeft: awayMinsLeft
          },
          homeTeam: {
            teamId: homeTeamId,
            teamName: homeTeam.name,
            teamAbbrev: homeTeam.abbrev,
            record: `${homeTeam.record.wins}-${homeTeam.record.losses}-${homeTeam.record.ties}`,
            divisionRank: homeTeam.record.divisionRank,
            score: Math.round(homeScore * 10) / 10,
            projectedTotal: Math.round(homeProjected * 10) / 10,
            currentlyPlaying: homeCurrentlyPlaying,
            yetToPlay: homeYetToPlay,
            minutesLeft: homeMinsLeft
          }
        };
      })
      .sort((a, b) => {
        if (a.week !== b.week) return a.week - b.week;
        return a.matchupIndex - b.matchupIndex;
      });
    
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.status(200).json(matchups);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

