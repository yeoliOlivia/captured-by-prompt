# Changelog

What changed in the app, newest first, in plain words. Add a line here when you change something people will notice.

## 2026-11-17

**Map mode**
- A **Map** switch in the top bar turns the whole page into a map of your trips. Each trip is a round photo pin that drops in, and hops when you hover over it.
- Click a pin to fly in. A card shows the trip's photos, dates, the people on it with how many photos each is in, who shows up most and who took the most photos. **Open trip** takes you to it.
- The map is drawn in plain grey to match the page, and goes dark with the dark theme.

**Trip stats and groupings**
- Each trip shows who shows up most, who took the most photos, the busiest day and how many places it covered.
- Ready-made sets for curating: most aesthetic, everyone together, pairs of people together, and scenery. "Most aesthetic" is sorted by colour, contrast, exposure and sharpness on your Mac, with no model call.

**Example trips**
- `npm run demo:trips` adds three example trips (Lisbon, Kyoto, Banff) with labelled people to your own workspace, with no model calls. They are not part of the default data.

**Trip map**
- The Trips screen has a map of where the trip's photos were taken, with one marker per spot (rounded to about 1 km). Click a marker to see its photos and who was found there. A menu shows only the spots where one person was found.
- The iPhone app has a **Trips** button with the same map, using Apple Maps.
- Photos added from the iPhone now keep their capture date and rounded location, and count as coming from your phone, so they show up in trips. Photos chosen before this update need to be re-added to get a location.

**Fixes**
- Editing a trip on the iPhone no longer removes its members.
- The iPhone app no longer reports an incompatible server when the Mac uses the Modal provider.

## 2026-10-30

**New look for the web app**
- The page is split into four screens in a top bar: **Search**, **People**, **Trips** and **Library**. It used to be one long page of stacked panels.
- Light and dark themes, with a toggle in the top bar. It follows your Mac's setting until you pick one.
- The model key moved into a settings sheet behind the gear button. It opens by itself when no key is loaded.
- Photos show in a tight 4-column grid. File names only appear on hover.
- Trip cards, people tiles and photos grow slightly when you hover over them.
- All colours and spacing live as tokens at the top of `playground/styles.css`.

**People**
- People show as round face tiles (their first reference photo), with tabs for People, Trips, Places and Other, and a name filter.
- Trips on the People screen show as wide cards with dates and the members' faces.

**Trips**
- Trips show as a horizontal strip of rounded cards. Click one to pool its photos below. The strip is centered when there are only a few trips.
- The trip editor picks members from face tiles: tap **+** to add someone, **−** to remove them.
- While you edit a trip's dates, it shows how many photos fall inside them.
- **Edit trip** and **New trip** buttons sit next to the trip dropdown.
- Deleting a person now also removes them from their trips. It used to refuse until you removed them by hand.

**Search and photos**
- Click any photo to open it large, with its folder, capture date and which phone it came from. From there you can add it as a reference photo for a person, place or trip.
- People used in a search show as face chips. Click one to edit that person.
- The reference photo picker has a search box that filters by file or folder name (for example `lfwtrip-refs`), with no model call.

**Colour**
- Switched to a pastel lavender palette on a lighter cream background. Buttons are mid lavender with dark text, selected tabs and toggles are light lavender, and links and outlines use a deeper lavender so they stay readable. Dark mode uses the same lavender on a plum-black background.

**Fixes**
- Buttons that need a model key (Search, Find people) used to grey out with no explanation. They now say a key is needed and open the key sheet.

## 2026-10-29

**Testing**
- Added a repeatable face test for trip pooling, built from public LFW photos, with an answer key and a scorer. See [trip pooling face test](trip-pooling-face-test.md). Commands: `npm run test:faces:build` and `npm run test:faces:score`.

## Before 2026-10-29

Earlier work (search, personal context, trip pooling, iPhone photo actions, the October audit) is described in the [README](../README.md) and the [October 2026 audit](audit-2026-10-12.md).
