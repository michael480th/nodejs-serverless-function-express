const { fetchESPNData, fetchTeamMetadata } = require("../utils/fetch");
const { getTeamName } = require("../utils/mappings");

// Starting lineup slot IDs (exclude bench, IR, etc.)
const STARTING_SLOTS = [0, 2, 4, 6, 16, 17, 23, 24]; // QB, RB, WR, TE, K, DEF, FLEX, OP

/**
 * Calculate projected total from roster entries for a specific week
 * Sums up appliedTotal for players who have played, plus projectedTotal for players yet to play
 */
function calculateProjectedTotal(rosterEntries, weekNum, currentScore) {
  const startingPlayers = rosterEntries.filter(e => STARTING_SLOTS.includes(e.lineupSlotId));
  
  let projected = 0;
  
  startingPlayers.forEach(entry => {
    const player = entry.playerPoolEntry?.player;
    if (!player) return;
    
    const stats = player.stats || [];
    const actualStats = stats.find(s => s.scoringPeriodId === weekNum && s.statSourceId === 0);
    const projectedStats = stats.find(s => s.scoringPeriodId === weekNum && s.statSourceId === 1);
    
    if (actualStats) {
      // Player has played - use actual points
      projected += (actualStats.appliedTotal || 0);
    } else if (projectedStats) {
      // Player hasn't played yet - use projected points
      projected += (projectedStats.projectedTotal || projectedStats.appliedTotal || 0);
    }
  });
  
  // If no players found or calculation is 0, use current score as fallback
  return projected > 0 ? projected : currentScore;
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
    
    // Always fetch roster data for calculating projections (especially for incomplete weeks)
    let rosterData = null;
    try {
      rosterData = await fetchESPNData(season, "mRoster");
    } catch (error) {
      console.warn("Could not fetch roster data for projections:", error.message);
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
        
        // If projections are missing or seem incomplete, calculate from roster
        // Try to get roster from matchup first (week-specific), then fall back to current roster
        let awayRoster = matchup.away?.rosterForMatchupPeriodId === weekNum 
          ? matchup.away?.roster?.entries || []
          : [];
        let homeRoster = matchup.home?.rosterForMatchupPeriodId === weekNum
          ? matchup.home?.roster?.entries || []
          : [];
        
        // If matchup doesn't have roster, use current roster data
        if (rosterData && (awayRoster.length === 0 || homeRoster.length === 0)) {
          if (awayRoster.length === 0) {
            awayRoster = rosterData.teams?.find(t => t.id === awayTeamId)?.roster?.entries || [];
          }
          if (homeRoster.length === 0) {
            homeRoster = rosterData.teams?.find(t => t.id === homeTeamId)?.roster?.entries || [];
          }
        }
        
        // Calculate from roster if projection is missing or if score is 0 (game hasn't started)
        if ((!awayProjected || awayScore === 0) && awayRoster.length > 0) {
          const calculated = calculateProjectedTotal(awayRoster, weekNum, awayScore);
          if (calculated > 0) awayProjected = calculated;
        }
        
        if ((!homeProjected || homeScore === 0) && homeRoster.length > 0) {
          const calculated = calculateProjectedTotal(homeRoster, weekNum, homeScore);
          if (calculated > 0) homeProjected = calculated;
        }
        
        // Fallback to current score if still no projection
        awayProjected = awayProjected || awayScore;
        homeProjected = homeProjected || homeScore;
        
        // Get player status counts
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
          w: weekNum,
          t1: awayTeam.name,
          s1: Math.round(awayScore * 10) / 10,
          p1: Math.round(awayProjected * 10) / 10,
          c1: awayCurrentlyPlaying,
          y1: awayYetToPlay,
          m1: awayMinsLeft,
          t2: homeTeam.name,
          s2: Math.round(homeScore * 10) / 10,
          p2: Math.round(homeProjected * 10) / 10,
          c2: homeCurrentlyPlaying,
          y2: homeYetToPlay,
          m2: homeMinsLeft
        };
      })
      .sort((a, b) => {
        if (a.w !== b.w) return a.w - b.w;
        return 0;
      });
    
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.status(200).json(matchups);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

