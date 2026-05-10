// Onboarding configuration
// Change any text, defaults or validation rules here without touching components

export const ONBOARDING_CONFIG = {
  // Step titles and descriptions
  steps: {
    createTeam: {
      title:    "Set Up Your Game",
      subtitle: "Takes 2 minutes. No account needed.",
      cta:      "Create Team →",
    },
    addPlayers: {
      title:    "Add Your Squad",
      subtitle: "Just their names for now. They'll get a unique link each.",
      cta:      "Continue →",
      skipCta:  "Skip — I'll add players later",
    },
    shareLinks: {
      title:    "You're Live 🎉",
      subtitle: "Share these links with your squad via WhatsApp.",
      cta:      "Go to Admin Dashboard →",
    },
  },

  // Form field defaults
  defaults: {
    dayOfWeek:        "Tuesday",
    kickoff:          "19:00",
    venue:            "",
    squadSize:        14,
    pricePerPlayer:   6,
    opensDay:         "Wednesday",
    opensTime:        "10:00",
    priorityLeadMins: 60,
  },

  // Validation rules
  validation: {
    groupName:      { required: true,  minLength: 2, maxLength: 50 },
    venue:          { required: false, minLength: 0, maxLength: 100 },
    squadSize:      { min: 2,  max: 50 },
    pricePerPlayer: { min: 0,  max: 100 },
    playerName:     { required: true,  minLength: 2, maxLength: 40 },
  },

  // Days of week options
  daysOfWeek: ["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"],

  // Max players you can add during onboarding
  maxPlayersOnboarding: 20,

  // WhatsApp message template
  whatsappMessage: (groupName, link) =>
    `Hey! I've set up ${groupName} on In or Out — the easiest way to sort who's playing each week.\n\nTap your personal link to confirm you're in or out:\n${link}\n\nBookmark it — you'll use it every week! 👊`,

  // Admin welcome message
  adminWelcome: (groupName, adminLink) =>
    `Your team "${groupName}" is live on In or Out!\n\nYour admin link (keep this private):\n${adminLink}`,
};
