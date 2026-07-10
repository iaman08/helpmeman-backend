const EDU_DOMAINS = [
  'iitb.ac.in', 'iitd.ac.in', 'iitm.ac.in', 'iitkgp.ac.in', 'iitk.ac.in',
  'iitg.ac.in', 'iith.ac.in', 'iiti.ac.in', 'iitbbs.ac.in', 'iitmandi.ac.in',
  'iitpkd.ac.in', 'iitropar.ac.in', 'iitrpr.ac.in', 'iitjammu.ac.in',
  'iitdh.ac.in', 'iitbhilai.ac.in', 'iitgoa.ac.in', 'iitpalakkad.ac.in',
  'aiims.edu', 'aiimsnagpur.edu.in', 'aiimspatna.edu.in', 'aiimsbhopal.edu.in',
  'aiimsrishikesh.edu.in', 'aiimsjodhpur.edu.in', 'aiimsmangalagiri.edu.in',
  'nlsiu.ac.in', 'nujs.edu', 'nalsar.ac.in', 'nlujodhpur.ac.in',
  'nlud.ac.in', 'nluassam.ac.in', 'nluo.ac.in',
  'bits-pilani.ac.in', 'pilani.bits-pilani.ac.in', 'goa.bits-pilani.ac.in',
  'hyderabad.bits-pilani.ac.in', 'dubai.bits-pilani.ac.in',
  'du.ac.in', 'iisc.ac.in', 'iimb.ac.in', 'iima.ac.in', 'iimc.ac.in',
  'iiml.ac.in', 'iimk.ac.in', 'iimi.ac.in', 'iimranchi.ac.in',
  'nsut.ac.in', 'dtu.ac.in', 'iiitd.ac.in', 'iiitb.ac.in',
  'nitt.edu', 'nitk.edu.in', 'nitw.ac.in', 'svnit.ac.in',
  'vit.ac.in', 'manipal.edu', 'srmist.edu.in', 'amity.edu',
];

const FAANG_DOMAINS = [
  'google.com', 'amazon.com', 'meta.com', 'apple.com', 'netflix.com',
  'microsoft.com', 'linkedin.com', 'uber.com', 'airbnb.com', 'stripe.com',
  'razorpay.com', 'flipkart.com', 'zomato.com', 'swiggy.in', 'paytm.com',
  'phonepe.com', 'ola.com', 'cred.club', 'groww.in', 'zerodha.com',
  'salesforce.com', 'adobe.com', 'oracle.com', 'ibm.com', 'intel.com',
  'nvidia.com', 'palantir.com', 'databricks.com', 'snowflake.com',
  'twitter.com', 'x.com', 'openai.com', 'anthropic.com',
  'walmart.com', 'deloitte.com', 'mckinsey.com', 'bcg.com', 'bain.com',
  'goldmansachs.com', 'jpmorgan.com', 'morganstanley.com',
];

function getEmailDomain(email) {
  return email.split('@')[1]?.toLowerCase();
}

function isValidCollegeEmail(email) {
  const domain = getEmailDomain(email);
  if (!domain) return false;
  return EDU_DOMAINS.includes(domain) || domain.endsWith('.ac.in') || domain.endsWith('.edu') || domain.endsWith('.edu.in');
}

function isValidCompanyEmail(email, companyName) {
  const domain = getEmailDomain(email);
  if (!domain) return false;
  return FAANG_DOMAINS.includes(domain);
}

function isValidStartupEmail(email) {
  const domain = getEmailDomain(email);
  if (!domain) return false;
  // Startup emails just need a custom domain (not free providers)
  const freeProviders = ['gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'protonmail.com'];
  return !freeProviders.includes(domain);
}

module.exports = {
  EDU_DOMAINS,
  FAANG_DOMAINS,
  getEmailDomain,
  isValidCollegeEmail,
  isValidCompanyEmail,
  isValidStartupEmail,
};
