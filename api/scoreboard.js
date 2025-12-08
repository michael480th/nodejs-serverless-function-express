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
      // Player has played - add their actual points
      score += (actualStats.appliedTotal || 0);
    }
  });
  
  return score;
}

/**
 * Calculate player status counts from roster entries for a specific week
 * Returns { yetToPlay, currentlyPlaying, minutesLeft }
 */
function calculatePlayerStatus(rosterEntries, weekNum) {
  const startingPlayers = rosterEntries.filter(e => STARTING_SLOTS.includes(e.lineupSlotId));
  
  let yetToPlay = 0;
  let currentlyPlaying = 0;
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
      // Estimate minutes left (60 for players in games today, 120 for players in games tomorrow)
      // This is a rough estimate - ESPN API might have more precise data
      minutesLeft += 60; // Default to 60 minutes per player
    } else if (actualStats && projectedStats) {
      const actualPoints = actualStats.appliedTotal || 0;
      const projectedPoints = projectedStats.projectedTotal || 0;
      // If projected is higher than actual, player is likely still playing
      if (projectedPoints > actualPoints) {
        currentlyPlaying++;
      }
    }
  });
  
  return { yetToPlay, currentlyPlaying, minutesLeft };
}

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
        
        // Calculate current scores - prefer roster calculation when available
        let awayScore = matchup.away?.totalPoints || 0;
        let homeScore = matchup.home?.totalPoints || 0;
        
        // Always calculate from roster if we have roster data (more accurate for incomplete games)
        if (rosterData && awayRoster.length > 0) {
          const calculatedScore = calculateCurrentScore(awayRoster, weekNum);
          // Use roster calculation if it's higher than matchup score, or if matchup score is 0
          if (calculatedScore > 0 && (calculatedScore > awayScore || awayScore === 0)) {
            awayScore = calculatedScore;
          }
        }
        
        if (rosterData && homeRoster.length > 0) {
          const calculatedScore = calculateCurrentScore(homeRoster, weekNum);
          if (calculatedScore > 0 && (calculatedScore > homeScore || homeScore === 0)) {
            homeScore = calculatedScore;
          }
        }
        
        // Calculate projected totals - prefer roster calculation when available
        let awayProjected = matchup.away?.totalProjectedPointsLive || matchup.away?.totalProjectedPoints;
        let homeProjected = matchup.home?.totalProjectedPointsLive || matchup.home?.totalProjectedPoints;
        
        // Always calculate from roster if we have roster data
        if (rosterData && awayRoster.length > 0) {
          const calculated = calculateProjectedTotal(awayRoster, weekNum, awayScore);
          // Use roster calculation if it's higher than matchup projection, or if no matchup projection
          if (calculated > awayScore && (!awayProjected || calculated > awayProjected)) {
            awayProjected = calculated;
          }
        }
        
        if (rosterData && homeRoster.length > 0) {
          const calculated = calculateProjectedTotal(homeRoster, weekNum, homeScore);
          if (calculated > homeScore && (!homeProjected || calculated > homeProjected)) {
            homeProjected = calculated;
          }
        }
        
        // Fallback to current score if still no projection
        awayProjected = awayProjected || awayScore;
        homeProjected = homeProjected || homeScore;
        
        // Get player status counts - prefer roster calculation when available
        let awayCurrentlyPlaying = matchup.away?.playersCurrentlyPlaying || 
                                   matchup.away?.playerIdsCurrentlyPlaying?.length || 0;
        let homeCurrentlyPlaying = matchup.home?.playersCurrentlyPlaying || 
                                   matchup.home?.playerIdsCurrentlyPlaying?.length || 0;
        let awayYetToPlay = matchup.away?.playersYetToPlay || 
                            matchup.away?.playerIdsYetToPlay?.length || 0;
        let homeYetToPlay = matchup.home?.playersYetToPlay || 
                            matchup.home?.playerIdsYetToPlay?.length || 0;
        let awayMinsLeft = matchup.away?.minutesRemaining || 0;
        let homeMinsLeft = matchup.home?.minutesRemaining || 0;
        
        // Always calculate from roster if we have roster data (more accurate for incomplete games)
        if (rosterData && awayRoster.length > 0) {
          const awayStatus = calculatePlayerStatus(awayRoster, weekNum);
          // Use roster calculation if it shows players yet to play, or if matchup data is 0
          if (awayStatus.yetToPlay > 0 || (awayYetToPlay === 0 && awayStatus.yetToPlay > 0)) {
            awayYetToPlay = awayStatus.yetToPlay;
          }
          if (awayStatus.currentlyPlaying > 0 || (awayCurrentlyPlaying === 0 && awayStatus.currentlyPlaying > 0)) {
            awayCurrentlyPlaying = awayStatus.currentlyPlaying;
          }
          if (awayStatus.minutesLeft > 0 || (awayMinsLeft === 0 && awayStatus.minutesLeft > 0)) {
            awayMinsLeft = awayStatus.minutesLeft;
          }
        }
        
        if (rosterData && homeRoster.length > 0) {
          const homeStatus = calculatePlayerStatus(homeRoster, weekNum);
          if (homeStatus.yetToPlay > 0 || (homeYetToPlay === 0 && homeStatus.yetToPlay > 0)) {
            homeYetToPlay = homeStatus.yetToPlay;
          }
          if (homeStatus.currentlyPlaying > 0 || (homeCurrentlyPlaying === 0 && homeStatus.currentlyPlaying > 0)) {
            homeCurrentlyPlaying = homeStatus.currentlyPlaying;
          }
          if (homeStatus.minutesLeft > 0 || (homeMinsLeft === 0 && homeStatus.minutesLeft > 0)) {
            homeMinsLeft = homeStatus.minutesLeft;
          }
        }
        
        return {
          w: weekNum,
          t1: awayTeam.name,
          s1: Math.round(awayScore * 10) / 10,
          p1: Math.round(awayProjected * 10) / 10,
          y1: awayYetToPlay,
          m1: awayMinsLeft,
          t2: homeTeam.name,
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
    
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.status(200).json(matchups);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

