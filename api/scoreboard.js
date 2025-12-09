const { fetchESPNData, fetchTeamMetadata } = require("../utils/fetch");
const { getTeamName } = require("../utils/mappings");

// Starting lineup slot IDs (exclude bench, IR, etc.)
const STARTING_SLOTS = [0, 2, 4, 6, 16, 17, 23, 24]; // QB, RB, WR, TE, K, DEF, FLEX, OP
const EXCLUDED_SLOTS = [20, 21]; // Bench, IR

/**
 * Calculate current score from roster entries for a specific week
 * Sums up appliedStatTotal (actual points) for players in starting positions who have played
 * Deduplicates by player ID to avoid counting the same player twice
 */
function calculateCurrentScore(rosterEntries, weekNum) {
  const startingPlayers = rosterEntries.filter(e => 
    STARTING_SLOTS.includes(e.lineupSlotId) && !EXCLUDED_SLOTS.includes(e.lineupSlotId)
  );
  
  let score = 0;
  const processedPlayerIds = new Set();
  
  startingPlayers.forEach(entry => {
    const player = entry.playerPoolEntry?.player;
    if (!player) return;
    
    const playerId = player.id;
    // Skip if we've already processed this player
    if (processedPlayerIds.has(playerId)) return;
    processedPlayerIds.add(playerId);
    
    const stats = player.stats || [];
    const actualStats = stats.find(s => s.scoringPeriodId === weekNum && s.statSourceId === 0);
    
    if (actualStats) {
      // appliedStatTotal = actual points scored
      score += (actualStats.appliedStatTotal || 0);
    }
  });
  
  return score;
}

/**
 * Calculate projected total from roster entries for a specific week
 * Sums up appliedStatTotal (actual) for players who have played, plus appliedTotal (forecast) for players yet to play
 * Deduplicates by player ID to avoid counting the same player twice
 */
function calculateProjectedTotal(rosterEntries, weekNum) {
  const startingPlayers = rosterEntries.filter(e => 
    STARTING_SLOTS.includes(e.lineupSlotId) && !EXCLUDED_SLOTS.includes(e.lineupSlotId)
  );
  
  let projected = 0;
  const processedPlayerIds = new Set();
  
  startingPlayers.forEach(entry => {
    const player = entry.playerPoolEntry?.player;
    if (!player) return;
    
    const playerId = player.id;
    // Skip if we've already processed this player
    if (processedPlayerIds.has(playerId)) return;
    processedPlayerIds.add(playerId);
    
    const stats = player.stats || [];
    const actualStats = stats.find(s => s.scoringPeriodId === weekNum && s.statSourceId === 0);
    const projectedStats = stats.find(s => s.scoringPeriodId === weekNum && s.statSourceId === 1);
    
    if (actualStats) {
      // Player has played - use actual points (appliedStatTotal)
      projected += (actualStats.appliedStatTotal || 0);
    } else if (projectedStats) {
      // Player hasn't played yet - use forecast points (appliedTotal)
      projected += (projectedStats.appliedTotal || 0);
    }
  });
  
  return projected;
}

/**
 * Calculate player status counts from roster entries for a specific week
 * Returns { yetToPlay, minutesLeft }
 * Deduplicates by player ID to avoid counting the same player twice
 */
function calculatePlayerStatus(rosterEntries, weekNum) {
  const startingPlayers = rosterEntries.filter(e => 
    STARTING_SLOTS.includes(e.lineupSlotId) && !EXCLUDED_SLOTS.includes(e.lineupSlotId)
  );
  
  let yetToPlay = 0;
  let minutesLeft = 0;
  const processedPlayerIds = new Set();
  
  startingPlayers.forEach(entry => {
    const player = entry.playerPoolEntry?.player;
    if (!player) return;
    
    const playerId = player.id;
    // Skip if we've already processed this player
    if (processedPlayerIds.has(playerId)) return;
    processedPlayerIds.add(playerId);
    
    const stats = player.stats || [];
    const actualStats = stats.find(s => s.scoringPeriodId === weekNum && s.statSourceId === 0);
    const projectedStats = stats.find(s => s.scoringPeriodId === weekNum && s.statSourceId === 1);
    
    if (!actualStats && projectedStats) {
      // Player hasn't played yet
      yetToPlay++;
      // Estimate 60 minutes per player (rough estimate)
      minutesLeft += 60;
    }
  });
  
  return { yetToPlay, minutesLeft };
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
    const week = req.query.week || null;
    
    // Fetch boxscore data - this contains everything we need
    const boxscoreData = await fetchESPNData(season, "mBoxscore");
    const schedule = boxscoreData.schedule || [];
    
    // Process matchups - calculate everything from matchup data
    const matchups = schedule
      .filter(m => !week || m.matchupPeriodId === parseInt(week))
      .map((matchup) => {
        const weekNum = matchup.matchupPeriodId || 0;
        const awayTeamId = matchup.away?.teamId || 0;
        const homeTeamId = matchup.home?.teamId || 0;
        
        // Get rosters from matchup data (week-specific)
        // Check multiple possible roster locations
        let awayRoster = matchup.away?.roster?.entries || [];
        let homeRoster = matchup.home?.roster?.entries || [];
        
        // For in-progress weeks, roster might be in a different location
        // Check if rosterForMatchupPeriodId matches the week
        if (awayRoster.length === 0 && matchup.away?.rosterForMatchupPeriodId === weekNum) {
          awayRoster = matchup.away?.roster?.entries || [];
        }
        if (homeRoster.length === 0 && matchup.home?.rosterForMatchupPeriodId === weekNum) {
          homeRoster = matchup.home?.roster?.entries || [];
        }
        
        // Determine if this is a completed week or in-progress
        // Check if winner is set (completed) or UNDECIDED/not set (in-progress)
        const isCompleted = matchup.winner && matchup.winner !== "UNDECIDED";
        
        let awayScore = 0;
        let homeScore = 0;
        let awayProjected = 0;
        let homeProjected = 0;
        
        if (isCompleted) {
          // For completed weeks, use API values
          awayScore = matchup.away?.totalPoints || 0;
          homeScore = matchup.home?.totalPoints || 0;
          awayProjected = awayScore; // Completed = no projection needed
          homeProjected = homeScore;
        } else {
          // For in-progress weeks, always calculate from roster if available
          if (awayRoster.length > 0) {
            const calculatedScore = calculateCurrentScore(awayRoster, weekNum);
            const calculatedProjected = calculateProjectedTotal(awayRoster, weekNum);
            
            // Use calculated values if they're > 0, otherwise fallback to API
            awayScore = calculatedScore > 0 ? calculatedScore : (matchup.away?.totalPointsLive ?? matchup.away?.totalPoints ?? 0);
            awayProjected = calculatedProjected > 0 ? calculatedProjected : awayScore;
          } else {
            // Fallback to API values if roster not available
            awayScore = matchup.away?.totalPointsLive ?? matchup.away?.totalPoints ?? 0;
            awayProjected = awayScore;
          }
          
          if (homeRoster.length > 0) {
            const calculatedScore = calculateCurrentScore(homeRoster, weekNum);
            const calculatedProjected = calculateProjectedTotal(homeRoster, weekNum);
            
            // Use calculated values if they're > 0, otherwise fallback to API
            homeScore = calculatedScore > 0 ? calculatedScore : (matchup.home?.totalPointsLive ?? matchup.home?.totalPoints ?? 0);
            homeProjected = calculatedProjected > 0 ? calculatedProjected : homeScore;
          } else {
            // Fallback to API values if roster not available
            homeScore = matchup.home?.totalPointsLive ?? matchup.home?.totalPoints ?? 0;
            homeProjected = homeScore;
          }
          
          // Final fallback to current score if projection is 0
          awayProjected = awayProjected || awayScore;
          homeProjected = homeProjected || homeScore;
        }
        
        // Calculate player status from roster
        let awayYetToPlay = 0;
        let awayMinsLeft = 0;
        let homeYetToPlay = 0;
        let homeMinsLeft = 0;
        
        if (awayRoster.length > 0) {
          const awayStatus = calculatePlayerStatus(awayRoster, weekNum);
          awayYetToPlay = awayStatus.yetToPlay;
          awayMinsLeft = awayStatus.minutesLeft;
        }
        
        if (homeRoster.length > 0) {
          const homeStatus = calculatePlayerStatus(homeRoster, weekNum);
          homeYetToPlay = homeStatus.yetToPlay;
          homeMinsLeft = homeStatus.minutesLeft;
        }
        
        return {
          w: weekNum,
          tid1: awayTeamId,
          s1: Math.round(awayScore * 10) / 10,
          p1: Math.round(awayProjected * 10) / 10,
          y1: awayYetToPlay,
          m1: awayMinsLeft,
          tid2: homeTeamId,
          s2: Math.round(homeScore * 10) / 10,
          p2: Math.round(homeProjected * 10) / 10,
          y2: homeYetToPlay,
          m2: homeMinsLeft
        };
      })
      .sort((a, b) => {
        if (a.w !== b.w) return a.w - b.w;
        return 0;
      });
    
    // Now fetch team metadata only for name mapping
    const teamData = await fetchTeamMetadata(season);
    const teamMap = {};
    (teamData.teams || []).forEach(team => {
      teamMap[team.id] = {
        name: getTeamName(team, teamData.members || [])
      };
    });
    
    // Map team IDs to names
    const result = matchups.map(m => ({
      w: m.w,
      t1: teamMap[m.tid1]?.name || `Team ${m.tid1}`,
      s1: m.s1,
      p1: m.p1,
      y1: m.y1,
      m1: m.m1,
      t2: teamMap[m.tid2]?.name || `Team ${m.tid2}`,
      s2: m.s2,
      p2: m.p2,
      y2: m.y2,
      m2: m.m2
    }));
    
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.status(200).json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
