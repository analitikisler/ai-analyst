// Loaded first by every test file (and preloaded by the test scripts): no test may reach an outside service.
// Every real client factory refuses with no_cloud while this is set; tests inject stubs instead.
process.env.AI_ANALYST_NO_CLOUD = "1";
