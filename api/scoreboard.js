const { fetchESPNData, fetchTeamMetadata } = require("../utils/fetch");
const { getTeamName } = require("../utils/mappings");

// Starting lineup slot IDs (exclude bench, IR, etc.)
const STARTING_SLOTS = [0, 2, 4, 6, 16, 17, 23, 24]; // QB, RB, WR, TE, K, DEF, FLEX, OP

/**
 * Calculate current score from roster entries for a specific week
 * Sums up appliedTotal for players in starting positions who have played
 */
function calculateCurrentScore(rosterEntries, weekNum) {
  const startingPlayers = rosterEntries.filter(e => STARTING_SLOTS.includes(e.lineupSlotId));
  
  let score = 0;
  
  startingPlayers.forEach(entry => {
    const player = entry.playerPoolEntry?.player;
    if (!player) return;
    
    const stats = player.stats || [];
    const actualStats = stats.find(s => s.scoringPeriodId === weekNum && s.statSourceId === 0);
    
    if (actualStats) {
      score += (actualStats.appliedTotal || 0);
    }
  });
  
  return score;
}

/**
 * Calculate projected total from roster entries for a specific week
 * Sums up appliedTotal for players who have played, plus projectedTotal for players yet to play
 */
function calculateProjectedTotal(rosterEntries, weekNum) {
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
  
  return projected;
}

/**
 * Calculate player status counts from roster entries for a specific week
 * Returns { yetToPlay, minutesLeft }
 */
function calculatePlayerStatus(rosterEntries, weekNum) {
  const startingPlayers = rosterEntries.filter(e => STARTING_SLOTS.includes(e.lineupSlotId));
  
  let yetToPlay = 0;
  let minutesLeft = 0;
  
  startingPlayers.forEach(entry => {
    const player = entry.playerPoolEntry?.player;
    if (!player) return;
    
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
    
    // Fetch matchup score data - this contains everything we need
    const matchupData = await fetchESPNData(season, "mMatchupScore");
    const schedule = matchupData.schedule || [];
    
    // Process matchups - calculate everything from matchup data
    const matchups = schedule
      .filter(m => !week || m.matchupPeriodId === parseInt(week))
      .map((matchup) => {
        const weekNum = matchup.matchupPeriodId || 0;
        const awayTeamId = matchup.away?.teamId || 0;
        const homeTeamId = matchup.home?.teamId || 0;
        
        // Get rosters from matchup data (week-specific)
        const awayRoster = matchup.away?.roster?.entries || [];
        const homeRoster = matchup.home?.roster?.entries || [];
        
        // Get current scores - use totalPointsLive for incomplete games, totalPoints for completed
        let awayScore = matchup.away?.totalPointsLive ?? matchup.away?.totalPoints ?? 0;
        let homeScore = matchup.home?.totalPointsLive ?? matchup.home?.totalPoints ?? 0;
        
        // If scores are 0, calculate from roster
        if (awayScore === 0 && awayRoster.length > 0) {
          awayScore = calculateCurrentScore(awayRoster, weekNum);
        }
        if (homeScore === 0 && homeRoster.length > 0) {
          homeScore = calculateCurrentScore(homeRoster, weekNum);
        }
        
        // Calculate projected totals from roster
        let awayProjected = 0;
        let homeProjected = 0;
        
        if (awayRoster.length > 0) {
          awayProjected = calculateProjectedTotal(awayRoster, weekNum);
        }
        if (homeRoster.length > 0) {
          homeProjected = calculateProjectedTotal(homeRoster, weekNum);
        }
        
        // Fallback to current score if projection is 0
        awayProjected = awayProjected || awayScore;
        homeProjected = homeProjected || homeScore;
        
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
