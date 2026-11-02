'use strict';

// The original audit asserted the defects themselves. The corrected reproducer
// now delegates to regressions that assert safe calculation AND STOP publication.
// The unmodified source and pre-fix failure logs accompany the release validation.
require('./ev-battery-transition-1.1.9.test').run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
